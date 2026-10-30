import json
import logging
from typing import Any, Dict, List, Optional
from aura_agent.config import settings
from aura_agent.models.schemas import ToolConfirmationProposal
from aura_agent.services.ollama import OllamaClient
from aura_agent.tools.audit import AuditLogger
from aura_agent.tools.base import ExecutionContext
from aura_agent.tools.registry import ToolRegistry

logger = logging.getLogger("aura.agent_loop")


class AgentLoop:
    """Manages the multi-turn LLM reasoning and controlled tool execution loop."""

    def __init__(
        self,
        ollama_client: OllamaClient,
        tool_registry: ToolRegistry,
        audit_logger: AuditLogger,
        max_iterations: int = 5,
    ):
        self.ollama_client = ollama_client
        self.tool_registry = tool_registry
        self.audit_logger = audit_logger
        self.max_iterations = max_iterations

    def _extract_embedded_tool_call(self, content: str) -> Optional[Dict[str, Any]]:
        """Fallback extractor for models that output JSON action blocks in raw markdown text."""
        if not content:
            return None
        content = content.strip()
        # Look for ```json ... ``` blocks
        if "```json" in content:
            try:
                start = content.find("```json") + 7
                end = content.find("```", start)
                if end != -1:
                    raw_json = content[start:end].strip()
                    data = json.loads(raw_json)
                    if isinstance(data, dict) and ("name" in data or "tool" in data or "action" in data):
                        name = data.get("name") or data.get("tool") or data.get("action")
                        args = data.get("arguments") or data.get("parameters") or data.get("args") or {}
                        return {"name": name, "arguments": args}
            except Exception:
                pass
        return None

    async def run_turn(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
        model: str,
        system_prompt: Optional[str] = None,
        policy: Optional[str] = None,
        user_confirmed: bool = False,
        ollama_client: Optional[OllamaClient] = None,
    ) -> Dict[str, Any]:
        """Execute one conversational agent turn, iterating between Ollama reasoning and tool calls."""
        client = ollama_client or self.ollama_client
        active_policy = policy or settings.tool_execution_policy
        current_messages = list(messages)
        tools = self.tool_registry.get_ollama_tools()

        executed_actions: List[Dict[str, Any]] = []
        seen_calls = set()

        final_content = ""
        eval_count_total = 0
        total_duration_ms = 0.0

        for iteration in range(self.max_iterations):
            logger.info("Agent loop iteration %d/%d for session %s", iteration + 1, self.max_iterations, session_id)

            response = await client.chat(
                messages=current_messages,
                model=model,
                system_prompt=system_prompt,
                tools=tools if tools else None,
            )

            content = response.get("content", "")
            raw_tool_calls = response.get("tool_calls", [])
            total_duration_ms += response.get("total_duration_ms", 0.0)
            eval_count_total += response.get("eval_count", 0)

            # Check for native tool calls or text fallback
            tool_calls_to_run = []
            if raw_tool_calls:
                for tc in raw_tool_calls:
                    fn = tc.get("function", {})
                    name = fn.get("name")
                    args = fn.get("arguments", {})
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    if name:
                        tool_calls_to_run.append({"name": name, "arguments": args, "raw": tc})
            else:
                embedded = self._extract_embedded_tool_call(content)
                if embedded and self.tool_registry.get(embedded["name"]):
                    tool_calls_to_run.append(embedded)

            # If no tool calls, this is the final assistant response
            if not tool_calls_to_run:
                final_content = content
                break

            # Execute tool calls
            paused_for_confirmation = False
            confirmation_proposal: Optional[ToolConfirmationProposal] = None

            for action in tool_calls_to_run:
                name = action["name"]
                args = action["arguments"]

                # Avoid duplicate identical calls in the same turn
                call_signature = f"{name}:{json.dumps(args, sort_keys=True)}"
                if call_signature in seen_calls:
                    logger.warning("Skipping repeated tool call: %s", call_signature)
                    continue
                seen_calls.add(call_signature)

                context = ExecutionContext(
                    session_id=session_id,
                    policy=active_policy,
                    user_confirmed=user_confirmed,
                    timeout=settings.tool_timeout_seconds,
                )

                exec_result = await self.tool_registry.execute_tool(
                    name=name,
                    parameters=args,
                    context=context,
                    audit_logger=self.audit_logger,
                )

                # Check if action requires human confirmation
                if exec_result.requires_confirmation:
                    paused_for_confirmation = True
                    confirmation_proposal = exec_result.confirmation_proposal
                    break

                executed_actions.append({
                    "name": name,
                    "parameters": args,
                    "result": exec_result.data,
                    "summary": exec_result.summary,
                    "success": exec_result.success,
                })

                # Append tool execution results into message history for the next Ollama iteration
                tool_output_dict = {
                    "tool": name,
                    "success": exec_result.success,
                    "summary": exec_result.summary,
                    "data": exec_result.data,
                    "error": exec_result.error,
                    "recovery_options": exec_result.recovery_options,
                }

                current_messages.append({
                    "role": "assistant",
                    "content": content or f"Calling tool {name}...",
                })
                current_messages.append({
                    "role": "tool",
                    "name": name,
                    "content": json.dumps(tool_output_dict),
                })

            if paused_for_confirmation:
                return {
                    "content": confirmation_proposal.reason if confirmation_proposal else "Action approval required.",
                    "requires_confirmation": True,
                    "confirmation_proposal": confirmation_proposal,
                    "tool_calls_executed": executed_actions,
                    "total_duration_ms": total_duration_ms,
                    "eval_count": eval_count_total,
                    "done": False,
                }

        # If loop reached max iterations without natural completion
        if not final_content and executed_actions:
            final_content = (
                "Completed requested operations:\n"
                + "\n".join([f"- **{a['name']}**: {a['summary']}" for a in executed_actions])
            )

        return {
            "content": final_content,
            "requires_confirmation": False,
            "confirmation_proposal": None,
            "tool_calls_executed": executed_actions,
            "total_duration_ms": total_duration_ms,
            "eval_count": eval_count_total,
            "done": True,
        }
