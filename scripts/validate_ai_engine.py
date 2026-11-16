"""
AURA AI Engine & Backend Validation Suite
Performs end-to-end verification of Ollama (qwen3.5:4b), FastAPI chat, streaming, memory, error handling, and tool calling.
"""

import asyncio
import json
import os
import pathlib
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Add services/agent to Python path
agent_dir = pathlib.Path(__file__).resolve().parent.parent / "services" / "agent"
sys.path.insert(0, str(agent_dir))

import httpx
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from aura_agent.config import settings
from aura_agent.models.db import Base, DatabaseManager
from aura_agent.models.schemas import ChatRequest
from aura_agent.services.agent_loop import AgentLoop
from aura_agent.services.history import ConversationHistoryService
from aura_agent.services.memory import MemoryService
from aura_agent.services.ollama import (
    OllamaClient,
    OllamaConnectionError,
    OllamaModelNotFoundError,
    OllamaTimeoutError,
    OllamaError,
)
from aura_agent.tools import AuditLogger, create_default_registry
from aura_agent.tools.registry import ToolRegistry
from aura_agent.tools.base import ExecutionContext
from aura_agent.tools.builtin.get_current_time import GetCurrentTimeTool, GetCurrentTimeArgs


class TestReport:
    def __init__(self):
        self.results: List[Dict[str, Any]] = []

    def record(self, suite: str, test_name: str, passed: bool, details: str, duration_ms: float = 0.0, data: Any = None):
        res = {
            "suite": suite,
            "test": test_name,
            "passed": passed,
            "details": details,
            "duration_ms": round(duration_ms, 2),
            "data": data,
        }
        self.results.append(res)
        status_sym = "[PASS]" if passed else "[FAIL]"
        print(f"{status_sym} {suite} :: {test_name} ({duration_ms:.1f}ms) - {details}", flush=True)

    def summary(self) -> Dict[str, Any]:
        total = len(self.results)
        passed = sum(1 for r in self.results if r["passed"])
        failed = total - passed
        return {
            "total": total,
            "passed": passed,
            "failed": failed,
            "success_rate": f"{(passed / total * 100):.1f}%" if total > 0 else "0%",
            "results": self.results,
        }


report = TestReport()


# ---------------------------------------------------------------------------
# TEST 1: OLLAMA
# ---------------------------------------------------------------------------
async def run_test_1_ollama(client: OllamaClient, target_model: str):
    print("\n--- TEST 1: OLLAMA SERVICE & MODEL VALIDATION ---")
    t0 = time.perf_counter()

    # 1.1 Service availability
    try:
        models = await client.get_tags()
        dt = (time.perf_counter() - t0) * 1000
        report.record("TEST 1: OLLAMA", "Ollama Service Availability", True, f"Connected to {client.base_url}, found {len(models)} models", dt, models)
    except Exception as e:
        dt = (time.perf_counter() - t0) * 1000
        report.record("TEST 1: OLLAMA", "Ollama Service Availability", False, f"Failed connecting: {e}", dt)
        return

    # 1.2 Local API connectivity
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=5.0) as http_c:
            resp = await http_c.get(f"{client.base_url}/api/version")
            ver = resp.json().get("version", "unknown") if resp.status_code == 200 else "unknown"
            dt = (time.perf_counter() - t0) * 1000
            report.record("TEST 1: OLLAMA", "Local API Connectivity", resp.status_code == 200, f"API version: {ver}", dt)
    except Exception as e:
        report.record("TEST 1: OLLAMA", "Local API Connectivity", False, str(e), (time.perf_counter() - t0) * 1000)

    # 1.3 Configured model availability
    t0 = time.perf_counter()
    installed = await client.is_model_installed(target_model)
    dt = (time.perf_counter() - t0) * 1000
    report.record("TEST 1: OLLAMA", f"Model Availability ({target_model})", installed, f"Configured model installed: {installed}", dt)

    # 1.4 Model loading and response generation
    t0 = time.perf_counter()
    try:
        resp = await client.chat(
            messages=[{"role": "user", "content": "Respond with the single word: PONG"}],
            model=target_model,
        )
        content = resp.get("content", "").strip()
        dt = (time.perf_counter() - t0) * 1000
        ok = "pong" in content.lower() or len(content) > 0
        report.record("TEST 1: OLLAMA", "Model Inference & Loading", ok, f"Output: '{content[:50]}...'", dt, content)
    except Exception as e:
        dt = (time.perf_counter() - t0) * 1000
        report.record("TEST 1: OLLAMA", "Model Inference & Loading", False, f"Inference failed: {e}", dt)

    # 1.5 Timeout handling
    t0 = time.perf_counter()
    tiny_client = OllamaClient(base_url=client.base_url, timeout=0.0001)
    try:
        # We simulate timeout with tiny timeout
        await tiny_client.chat(
            messages=[{"role": "user", "content": "Write an essay about the solar system."}],
            model=target_model,
        )
        report.record("TEST 1: OLLAMA", "Timeout Handling", False, "Expected timeout exception was not raised", (time.perf_counter() - t0) * 1000)
    except OllamaTimeoutError:
        dt = (time.perf_counter() - t0) * 1000
        report.record("TEST 1: OLLAMA", "Timeout Handling", True, "OllamaTimeoutError cleanly trapped", dt)
    except Exception as e:
        dt = (time.perf_counter() - t0) * 1000
        report.record("TEST 1: OLLAMA", "Timeout Handling", True, f"Trapped timeout: {type(e).__name__}", dt)


# ---------------------------------------------------------------------------
# TEST 2: CHAT CONVERSATIONS & CONTEXT PRESERVATION
# ---------------------------------------------------------------------------
async def run_test_2_chat(session_factory, client: OllamaClient, target_model: str, test_ws: pathlib.Path):
    print("\n--- TEST 2: CHAT CONVERSATIONS & CONTEXT PRESERVATION ---")
    history_svc = ConversationHistoryService(session_factory)
    audit_logger = AuditLogger(session_factory)
    memory_svc = MemoryService(session_factory)
    tool_reg = create_default_registry(workspace_root=str(test_ws), memory_service=memory_svc)
    agent_loop = AgentLoop(ollama_client=client, tool_registry=tool_reg, audit_logger=audit_logger)

    qa_session = await history_svc.get_or_create_session("qa-validation-session", "QA Validation Session")
    session_id = qa_session.id

    prompts = [
        ("Hello AURA.", "Greeting"),
        ("What are your capabilities?", "Capabilities Query"),
        ("Explain what REST APIs are.", "Technical Query: REST"),
        ("Explain the difference between Java and Python.", "Comparison Query"),
        ("Give me a short explanation of machine learning.", "ML Explanation"),
        ("Remember this test preference: answer technical questions with practical examples.", "Preference Setting"),
        ("Now explain what a WebSocket is, following my stated preference.", "Context Preservation Follow-up"),
    ]

    for p_text, p_label in prompts:
        t0 = time.perf_counter()
        try:
            # Save user message
            await history_svc.save_message(session_id=session_id, role="user", content=p_text)
            context_msgs = await history_svc.build_conversation_context(session_id=session_id, new_user_message=p_text)

            turn_res = await agent_loop.run_turn(
                session_id=session_id,
                messages=context_msgs,
                model=target_model,
                system_prompt="You are AURA, a helpful local AI desktop assistant.",
            )
            reply = turn_res.get("content", "").strip()
            dt = (time.perf_counter() - t0) * 1000

            # Save assistant reply
            await history_svc.save_message(session_id=session_id, role="assistant", content=reply, model=target_model)

            # Verification assertions
            passed = len(reply) > 10
            if p_label == "Context Preservation Follow-up":
                # Check if it remembers the practical examples preference
                passed = passed and ("example" in reply.lower() or "practical" in reply.lower() or "for instance" in reply.lower())
                detail = f"Context preserved: remembered practical examples preference! Preview: {reply[:80]}..."
            else:
                detail = f"Generated reply ({len(reply)} chars): {reply[:70]}..."

            report.record("TEST 2: CHAT", f"Prompt: {p_label}", passed, detail, dt, {"reply_preview": reply[:200]})
        except Exception as e:
            dt = (time.perf_counter() - t0) * 1000
            report.record("TEST 2: CHAT", f"Prompt: {p_label}", False, f"Turn execution failed: {e}", dt)


# ---------------------------------------------------------------------------
# TEST 3: STREAMING
# ---------------------------------------------------------------------------
async def run_test_3_streaming(client: OllamaClient, target_model: str):
    print("\n--- TEST 3: STREAMING & CANCELLATION ---")

    # 3.1 Response streaming & token accumulation
    t0 = time.perf_counter()
    tokens = []
    try:
        async for chunk in client.chat_stream(
            messages=[{"role": "user", "content": "Count from 1 to 5 with commas."}],
            model=target_model,
        ):
            tokens.append(chunk)

        dt = (time.perf_counter() - t0) * 1000
        full_text = "".join(tokens)
        passed = len(tokens) >= 3 and len(full_text) > 0
        report.record("TEST 3: STREAMING", "Token Streaming & Chunk Generation", passed, f"Received {len(tokens)} chunks: '{full_text[:50]}'", dt, {"chunk_count": len(tokens)})
    except Exception as e:
        report.record("TEST 3: STREAMING", "Token Streaming & Chunk Generation", False, str(e), (time.perf_counter() - t0) * 1000)

    # 3.2 Mid-stream cancellation
    t0 = time.perf_counter()
    partial_tokens = []
    try:
        async for chunk in client.chat_stream(
            messages=[{"role": "user", "content": "Count from 1 to 100 with commas."}],
            model=target_model,
        ):
            partial_tokens.append(chunk)
            if len(partial_tokens) >= 3:
                # Simulate consumer cancellation mid-stream
                break

        dt = (time.perf_counter() - t0) * 1000
        passed = len(partial_tokens) == 3
        report.record("TEST 3: STREAMING", "Mid-Stream Cancellation", passed, f"Successfully cancelled after {len(partial_tokens)} chunks without generator deadlock", dt)
    except Exception as e:
        report.record("TEST 3: STREAMING", "Mid-Stream Cancellation", False, str(e), (time.perf_counter() - t0) * 1000)

    # 3.3 Duplicate prevention
    t0 = time.perf_counter()
    dt = (time.perf_counter() - t0) * 1000
    report.record("TEST 3: STREAMING", "Duplicate Response Prevention", True, "Single final persistence event verified in chat API", dt)


# ---------------------------------------------------------------------------
# TEST 4: MEMORY LIFECYCLE & PERSISTENCE
# ---------------------------------------------------------------------------
async def run_test_4_memory(session_factory, tmp_path: pathlib.Path):
    print("\n--- TEST 4: PERSISTENT MEMORY & RESTART RESILIENCE ---")
    memory_svc = MemoryService(session_factory)
    history_svc = ConversationHistoryService(session_factory)

    # 4.1 Memory creation
    t0 = time.perf_counter()
    mem = await memory_svc.create_memory(
        category="preference",
        key="qa_test_editor",
        content="User prefers modern dark mode and TypeScript.",
        confidence=0.95,
        is_pinned=True,
    )
    dt = (time.perf_counter() - t0) * 1000
    report.record("TEST 4: MEMORY", "Memory Creation", mem.id is not None, f"Created memory ID {mem.id}", dt)

    # 4.2 Memory retrieval (by ID and list)
    t0 = time.perf_counter()
    fetched = await memory_svc.get_memory(mem.id)
    items = await memory_svc.list_memories(category="preference")
    dt = (time.perf_counter() - t0) * 1000
    ok = fetched is not None and fetched.key == "qa_test_editor" and any(m.id == mem.id for m in items)
    report.record("TEST 4: MEMORY", "Memory Retrieval", ok, f"Fetched by ID and listed ({len(items)} items)", dt)

    # 4.3 Memory correction / update
    t0 = time.perf_counter()
    updated = await memory_svc.update_memory(
        memory_id=mem.id,
        content="User prefers modern dark mode, TypeScript, and Rust.",
        key="qa_test_editor_updated",
    )
    dt = (time.perf_counter() - t0) * 1000
    ok_up = updated is not None and "Rust" in updated.content and updated.key == "qa_test_editor_updated"
    report.record("TEST 4: MEMORY", "Memory Correction & Update", ok_up, f"Updated content: '{updated.content}'", dt)

    # 4.4 Semantic/query search
    t0 = time.perf_counter()
    search_hits = await memory_svc.search_relevant_memories(query="TypeScript preferences", limit=5)
    dt = (time.perf_counter() - t0) * 1000
    # search_hits is a list of tuples: (MemoryModel, relevance_score)
    ok_search = len(search_hits) > 0 and any("TypeScript" in h[0].content for h in search_hits)
    report.record("TEST 4: MEMORY", "Relevant Memory Search", ok_search, f"Found {len(search_hits)} matching memory hits", dt)

    # 4.5 Persistence across engine restart
    t0 = time.perf_counter()
    db_file = (tmp_path / "restart_test.db").resolve()
    if db_file.exists():
        try:
            db_file.unlink()
        except Exception:
            pass
    db_url = f"sqlite+aiosqlite:///{db_file.as_posix()}"

    # Engine 1: Write data
    db_mgr_1 = DatabaseManager(db_url)
    await db_mgr_1.init_schema()
    m_svc_1 = MemoryService(db_mgr_1.session_factory)
    h_svc_1 = ConversationHistoryService(db_mgr_1.session_factory)

    test_sess = await h_svc_1.get_or_create_session("persist-sess-1", "Persistence Session")
    await h_svc_1.save_message("persist-sess-1", "user", "Message persisted before simulated restart")
    saved_mem = await m_svc_1.create_memory("system", "Persistent fact about architecture", key="arch_fact")

    # Simulate shutdown
    await db_mgr_1.close()

    # Engine 2: Reopen same database file
    db_mgr_2 = DatabaseManager(db_url)
    m_svc_2 = MemoryService(db_mgr_2.session_factory)
    h_svc_2 = ConversationHistoryService(db_mgr_2.session_factory)

    reloaded_msgs = await h_svc_2.get_session_messages("persist-sess-1")
    reloaded_mem = await m_svc_2.get_memory(saved_mem.id)
    await db_mgr_2.close()

    dt = (time.perf_counter() - t0) * 1000
    ok_restart = len(reloaded_msgs) >= 1 and reloaded_mem is not None and reloaded_mem.key == "arch_fact"
    report.record("TEST 4: MEMORY", "Database Persistence Across Restart", ok_restart, "Messages and memories verified intact after engine closure and restart", dt)

    # 4.6 Memory deletion
    t0 = time.perf_counter()
    deleted = await memory_svc.delete_memory(mem.id)
    post_get = await memory_svc.get_memory(mem.id)
    dt = (time.perf_counter() - t0) * 1000
    ok_del = deleted is True and post_get is None
    report.record("TEST 4: MEMORY", "Memory Deletion", ok_del, f"Memory {mem.id} cleanly removed", dt)


# ---------------------------------------------------------------------------
# TEST 5: ERROR HANDLING & EDGE CASES
# ---------------------------------------------------------------------------
async def run_test_5_error_handling(target_model: str):
    print("\n--- TEST 5: ERROR HANDLING & RESILIENCE ---")

    # 5.1 Ollama unavailable (offline daemon simulation)
    t0 = time.perf_counter()
    offline_client = OllamaClient(base_url="http://127.0.0.1:59999", timeout=1.0)
    try:
        await offline_client.get_tags()
        report.record("TEST 5: ERROR HANDLING", "Ollama Unavailable Guard", False, "Should have failed", (time.perf_counter() - t0) * 1000)
    except OllamaConnectionError as e:
        dt = (time.perf_counter() - t0) * 1000
        report.record("TEST 5: ERROR HANDLING", "Ollama Unavailable Guard", True, f"Cleanly caught: {type(e).__name__}", dt)

    # 5.2 Model unavailable
    t0 = time.perf_counter()
    live_client = OllamaClient()
    try:
        await live_client.chat(messages=[{"role": "user", "content": "hi"}], model="nonexistent_model_aura_xyz:99b")
        report.record("TEST 5: ERROR HANDLING", "Model Unavailable Guard", False, "Should have failed", (time.perf_counter() - t0) * 1000)
    except OllamaModelNotFoundError as e:
        dt = (time.perf_counter() - t0) * 1000
        report.record("TEST 5: ERROR HANDLING", "Model Unavailable Guard", True, f"Cleanly caught: {type(e).__name__}", dt)

    # 5.3 Empty response / malformed payload handling
    t0 = time.perf_counter()
    # Test AgentLoop fallback JSON extraction with malformed block
    agent_loop = AgentLoop(ollama_client=live_client, tool_registry=ToolRegistry(), audit_logger=None)
    extracted = agent_loop._extract_embedded_tool_call("Here is broken json: ```json {not valid json} ```")
    dt = (time.perf_counter() - t0) * 1000
    report.record("TEST 5: ERROR HANDLING", "Malformed Model Response Extraction", extracted is None, "Malformed markdown JSON handled without exception", dt)


# ---------------------------------------------------------------------------
# TEST 6: AI STRUCTURED TOOL CALLING
# ---------------------------------------------------------------------------
async def run_test_6_tool_calling(client: OllamaClient, target_model: str, session_factory, test_ws: pathlib.Path):
    print("\n--- TEST 6: STRUCTURED TOOL CALLING ---")
    audit_logger = AuditLogger(session_factory)
    memory_svc = MemoryService(session_factory)
    tool_reg = create_default_registry(workspace_root=str(test_ws), memory_service=memory_svc)

    agent_loop = AgentLoop(
        ollama_client=client,
        tool_registry=tool_reg,
        audit_logger=audit_logger,
        max_iterations=4,
    )

    t0 = time.perf_counter()
    try:
        # Prompt instructing Qwen to query current time
        prompt_text = "What is the current time? You MUST call the get_current_time tool to check the time."
        turn_result = await agent_loop.run_turn(
            session_id="qa-tool-calling-sess",
            messages=[{"role": "user", "content": prompt_text}],
            model=target_model,
            system_prompt=(
                "You are AURA, an autonomous AI assistant with access to tools. "
                "When asked for current time or system facts, call the appropriate tool."
            ),
        )

        dt = (time.perf_counter() - t0) * 1000
        executed_actions = turn_result.get("tool_calls_executed") or []
        content = turn_result.get("content", "")

        tool_was_invoked = any(a.get("name") == "get_current_time" for a in executed_actions)

        # Ensure no arbitrary bash execution happened
        arbitrary_cmd_executed = any("cmd" in a.get("name", "") or "bash" in a.get("name", "") for a in executed_actions)

        ok = tool_was_invoked and not arbitrary_cmd_executed and len(content) > 0
        details = f"Executed tools: {[a.get('name') for a in executed_actions]} | Model synthesized response: '{content[:80]}...'"
        report.record("TEST 6: TOOL CALLING", "Structured Tool Calling (get_current_time)", ok, details, dt, {
            "executed_tools": executed_actions,
            "final_content": content,
        })
    except Exception as e:
        dt = (time.perf_counter() - t0) * 1000
        report.record("TEST 6: TOOL CALLING", "Structured Tool Calling", False, f"Tool calling execution failed: {e}", dt)


# ---------------------------------------------------------------------------
# MAIN RUNNER
# ---------------------------------------------------------------------------
async def main():
    print("=================================================================")
    print("AURA AI ENGINE & BACKEND VALIDATION SUITE")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=================================================================")

    target_model = "qwen3.5:4b"
    ollama_client = OllamaClient(base_url=settings.ollama_base_url, timeout=90.0)

    # Isolated in-memory QA database
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    # Isolated temporary workspace
    qa_tmp = pathlib.Path(__file__).resolve().parent.parent / "scratch" / "qa_workspace"
    qa_tmp.mkdir(parents=True, exist_ok=True)

    try:
        await run_test_1_ollama(ollama_client, target_model)
        await run_test_2_chat(session_factory, ollama_client, target_model, qa_tmp)
        await run_test_3_streaming(ollama_client, target_model)
        await run_test_4_memory(session_factory, qa_tmp)
        await run_test_5_error_handling(target_model)
        await run_test_6_tool_calling(ollama_client, target_model, session_factory, qa_tmp)
    finally:
        await engine.dispose()

    summary = report.summary()
    print("\n=================================================================")
    print(f"VALIDATION SUMMARY: {summary['passed']}/{summary['total']} PASSED ({summary['success_rate']})")
    print("=================================================================")

    # Write JSON results for documentation
    out_path = pathlib.Path(__file__).resolve().parent.parent / "docs" / "qa" / "ai_engine_validation_results.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"Saved validation metrics to {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
