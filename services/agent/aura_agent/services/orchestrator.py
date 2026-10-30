import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from aura_agent.config import settings
from aura_agent.models.db import TaskModel, TaskStepModel
from aura_agent.models.schemas import (
    CreateTaskPlanRequest,
    CreateTaskRequest,
    TaskCancelRequest,
    TaskConfirmationRequest,
    TaskPlanSchema,
    TaskSchema,
    TaskStepDefinition,
    TaskStepSchema,
    ToolConfirmationProposal,
)
from aura_agent.services.ollama import OllamaClient
from aura_agent.tools.audit import AuditLogger
from aura_agent.tools.base import ExecutionContext, RiskTier
from aura_agent.tools.registry import ToolRegistry

logger = logging.getLogger("aura.orchestrator")


class PlanValidationError(Exception):
    """Raised when a task plan fails pre-execution structural or tool validation."""
    pass


class TaskOrchestrator:
    """Orchestrates multi-step, typed task execution using the AURA tool registry.

    Implements plan validation, step tracking, permission gates, timeouts,
    retry limits, duplicate side effect prevention, cancellation, and concise reporting.
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        tool_registry: ToolRegistry,
        audit_logger: AuditLogger,
        ollama_client: Optional[OllamaClient] = None,
    ):
        self.session_factory = session_factory
        self.tool_registry = tool_registry
        self.audit_logger = audit_logger
        self.ollama_client = ollama_client
        self._cancelled_tasks: Set[str] = set()
        self._pending_proposals: Dict[str, ToolConfirmationProposal] = {}

    def is_side_effect_tool(self, tool_name: str) -> bool:
        """Identify if a tool causes permanent or external side effects."""
        tool = self.tool_registry.get(tool_name)
        if not tool:
            return True
        return tool.risk_tier in (
            RiskTier.TIER_2_MONITORED_WRITE,
            RiskTier.TIER_3_SYSTEM_EXTERNAL,
            RiskTier.TIER_4_PROHIBITED,
        )

    def validate_plan(self, plan: TaskPlanSchema | CreateTaskRequest) -> None:
        """Validate an ordered task plan before any execution begins.

        Ensures:
        1. Non-empty steps sequence within system bounds.
        2. All referenced tools exist in the tool registry.
        3. No prohibited (Tier 4) tools are present.
        4. Tool parameters conform strictly to tool Pydantic argument schemas.
        """
        if not plan.steps:
            raise PlanValidationError("Task plan must contain at least one step.")

        if len(plan.steps) > settings.task_max_steps:
            raise PlanValidationError(
                f"Task plan exceeds maximum allowed steps ({len(plan.steps)} > {settings.task_max_steps})."
            )

        for idx, step in enumerate(plan.steps):
            if not step.title or not step.title.strip():
                raise PlanValidationError(f"Step {idx + 1} must have a non-empty title.")

            tool = self.tool_registry.get(step.tool_name)
            if not tool:
                known_tools = list(self.tool_registry._tools.keys())
                raise PlanValidationError(
                    f"Step {idx + 1} ('{step.title}') references unknown tool '{step.tool_name}'. "
                    f"Available tools: {known_tools}"
                )

            if tool.risk_tier == RiskTier.TIER_4_PROHIBITED:
                raise PlanValidationError(
                    f"Step {idx + 1} ('{step.title}') attempts prohibited Tier 4 tool '{step.tool_name}'."
                )

            # Validate parameter schema
            try:
                tool.args_schema(**step.parameters)
            except Exception as e:
                raise PlanValidationError(
                    f"Step {idx + 1} ('{step.title}') has invalid parameters for '{step.tool_name}': {e}"
                )

    async def generate_plan_from_request(
        self,
        request: CreateTaskPlanRequest,
        ollama_client: Optional[OllamaClient] = None,
    ) -> TaskPlanSchema:
        """Convert a user request into a structured task plan using the local Ollama model."""
        client = ollama_client or self.ollama_client
        if not client:
            raise ValueError("Ollama client is not configured for task plan generation.")

        catalog = self.tool_registry.get_catalog()
        tools_summary = "\n".join([
            f"- {t.name} ({t.risk_tier}): {t.description}. Params: {json.dumps(t.parameters)}"
            for t in catalog
        ])

        system_prompt = (
            "You are AURA's Task Planning Engine. Your role is to convert a user request into a "
            "precise, sequential, multi-step task plan using ONLY registered tools.\n\n"
            "AVAILABLE TOOLS:\n"
            f"{tools_summary}\n\n"
            "RULES:\n"
            "1. Output ONLY a valid JSON object matching this schema:\n"
            "{\n"
            '  "title": "Short task title",\n'
            '  "description": "Clear description of the goal",\n'
            '  "steps": [\n'
            '    {\n'
            '      "title": "Step label",\n'
            '      "tool_name": "exact_tool_name",\n'
            '      "parameters": {"param_key": "param_value"},\n'
            '      "max_retries": 2\n'
            "    }\n"
            "  ]\n"
            "}\n"
            "2. Order steps logically (e.g. read before modify, search before extract).\n"
            "3. Do not invent non-existent tools or parameters.\n"
            "4. Do not wrap in markdown quotes if possible, output pure JSON."
        )

        messages = [{"role": "user", "content": request.user_request}]
        response = await client.chat(
            messages=messages,
            model=request.model_override or settings.model_name,
            system_prompt=system_prompt,
        )

        raw_content = response.get("content", "").strip()
        # Clean markdown codeblocks if model included them
        if raw_content.startswith("```"):
            lines = raw_content.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw_content = "\n".join(lines).strip()

        try:
            data = json.loads(raw_content)
            plan = TaskPlanSchema(**data)
        except Exception as e:
            logger.error("Failed to parse model plan output: %s\nRaw output: %s", e, raw_content)
            raise PlanValidationError(f"Model generated invalid task plan: {e}")

        # Validate against registry
        self.validate_plan(plan)
        return plan

    async def create_task(self, request: CreateTaskRequest) -> TaskSchema:
        """Validate and persist a new multi-step task plan in SQLite."""
        self.validate_plan(request)

        async with self.session_factory() as session:
            task = TaskModel(
                session_id=request.session_id,
                title=request.title,
                description=request.description or request.title,
                state="planned",
                current_step_index=0,
                total_steps=len(request.steps),
                max_retries_per_step=request.max_retries_per_step,
                max_total_tool_calls=request.max_total_tool_calls,
                total_tool_calls=0,
                plan_json=json.dumps([s.model_dump() for s in request.steps]),
            )
            session.add(task)
            await session.flush()

            for idx, s_def in enumerate(request.steps):
                step = TaskStepModel(
                    task_id=task.id,
                    step_index=idx,
                    title=s_def.title,
                    tool_name=s_def.tool_name,
                    parameters_json=json.dumps(s_def.parameters),
                    state="pending",
                    retry_count=0,
                    max_retries=s_def.max_retries,
                    side_effect_occurred=False,
                )
                session.add(step)

            await session.commit()
            return await self._load_task_schema(session, task.id)

    async def get_task(self, task_id: str) -> Optional[TaskSchema]:
        """Fetch task details, current step progress, and confirmation proposals."""
        async with self.session_factory() as session:
            return await self._load_task_schema(session, task_id)

    async def list_tasks(
        self,
        session_id: Optional[str] = None,
        state: Optional[str] = None,
        limit: int = 50,
    ) -> List[TaskSchema]:
        """List tasks with optional session or state filters."""
        async with self.session_factory() as session:
            query = select(TaskModel).options(selectinload(TaskModel.steps)).order_by(TaskModel.created_at.desc())
            if session_id:
                query = query.where(TaskModel.session_id == session_id)
            if state:
                query = query.where(TaskModel.state == state)
            query = query.limit(limit)

            result = await session.execute(query)
            tasks = result.scalars().all()
            return [self._model_to_schema(t) for t in tasks]

    async def cancel_task(self, task_id: str, reason: str = "Cancelled by user") -> TaskSchema:
        """Cancel a running, planned, or waiting task."""
        self._cancelled_tasks.add(task_id)
        if task_id in self._pending_proposals:
            del self._pending_proposals[task_id]

        async with self.session_factory() as session:
            result = await session.execute(
                select(TaskModel).options(selectinload(TaskModel.steps)).where(TaskModel.id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                raise ValueError(f"Task with ID '{task_id}' not found.")

            if task.state not in ("completed", "failed", "cancelled"):
                task.state = "cancelled"
                task.completed_at = datetime.now(timezone.utc)
                task.error_message = reason

                # Update steps
                for step in task.steps:
                    if step.state in ("pending", "running", "waiting_for_confirmation"):
                        step.state = "cancelled"

                task.final_report = self._build_final_report(task)
                await session.commit()

            return self._model_to_schema(task)

    async def confirm_task_step(
        self,
        task_id: str,
        confirmation: TaskConfirmationRequest,
    ) -> TaskSchema:
        """Process user confirmation for a consequential task step and resume execution."""
        if task_id not in self._pending_proposals:
            task = await self.get_task(task_id)
            if not task or task.state != "waiting_for_confirmation":
                raise ValueError(f"Task '{task_id}' is not currently awaiting confirmation.")

        if not confirmation.approved:
            # Rejection stops the task immediately
            if task_id in self._pending_proposals:
                del self._pending_proposals[task_id]

            async with self.session_factory() as session:
                result = await session.execute(
                    select(TaskModel).options(selectinload(TaskModel.steps)).where(TaskModel.id == task_id)
                )
                task = result.scalar_one_or_none()
                if task:
                    task.state = "failed"
                    reason = confirmation.guidance or "User rejected consequential action confirmation."
                    task.error_message = reason
                    if task.current_step_index < len(task.steps):
                        cur_step = task.steps[task.current_step_index]
                        cur_step.state = "failed"
                        cur_step.error_message = reason
                    task.final_report = self._build_final_report(task)
                    await session.commit()
                return self._model_to_schema(task)

        # Approved: resume execution
        if task_id in self._pending_proposals:
            del self._pending_proposals[task_id]

        return await self.execute_task(task_id, step_user_confirmed=True)

    async def execute_task(
        self,
        task_id: str,
        step_user_confirmed: bool = False,
    ) -> TaskSchema:
        """Execute an ordered task plan step-by-step with state verification and error handling."""
        async with self.session_factory() as session:
            result = await session.execute(
                select(TaskModel).options(selectinload(TaskModel.steps)).where(TaskModel.id == task_id)
            )
            task = result.scalar_one_or_none()
            if not task:
                raise ValueError(f"Task with ID '{task_id}' not found.")

            if task.state in ("completed", "failed", "cancelled"):
                return self._model_to_schema(task)

            # Transition task to running
            task.state = "running"
            await session.commit()

        # Step-by-step execution loop
        while True:
            # Refresh task state
            async with self.session_factory() as session:
                result = await session.execute(
                    select(TaskModel).options(selectinload(TaskModel.steps)).where(TaskModel.id == task_id)
                )
                task = result.scalar_one()

                # Check if all steps done
                if task.current_step_index >= len(task.steps):
                    task.state = "completed"
                    task.completed_at = datetime.now(timezone.utc)
                    task.final_report = self._build_final_report(task)
                    await session.commit()
                    return self._model_to_schema(task)

                current_step = task.steps[task.current_step_index]

                # Check cancellation
                if task_id in self._cancelled_tasks:
                    task.state = "cancelled"
                    task.completed_at = datetime.now(timezone.utc)
                    current_step.state = "cancelled"
                    task.final_report = self._build_final_report(task)
                    await session.commit()
                    return self._model_to_schema(task)

                # Check total tool calls cap
                if task.total_tool_calls >= task.max_total_tool_calls:
                    err = f"Total tool call limit exceeded (max: {task.max_total_tool_calls})."
                    task.state = "failed"
                    task.error_message = err
                    current_step.state = "failed"
                    current_step.error_message = err
                    task.completed_at = datetime.now(timezone.utc)
                    task.final_report = self._build_final_report(task)
                    await session.commit()
                    return self._model_to_schema(task)

                # Parse parameters
                parameters = json.loads(current_step.parameters_json)
                tool = self.tool_registry.get(current_step.tool_name)
                if not tool:
                    err = f"Tool '{current_step.tool_name}' is not registered."
                    task.state = "failed"
                    task.error_message = err
                    current_step.state = "failed"
                    current_step.error_message = err
                    task.completed_at = datetime.now(timezone.utc)
                    task.final_report = self._build_final_report(task)
                    await session.commit()
                    return self._model_to_schema(task)

                # Permission / Confirmation check
                ctx = ExecutionContext(
                    session_id=task.session_id,
                    policy=settings.tool_execution_policy,
                    user_confirmed=step_user_confirmed,
                    timeout=settings.task_step_timeout_seconds,
                )

                confirmation_reason = self.tool_registry.is_confirmation_required(
                    tool=tool,
                    parameters=parameters,
                    context=ctx,
                )

                if confirmation_reason and not step_user_confirmed:
                    # Require human confirmation
                    proposal = ToolConfirmationProposal(
                        call_id=f"task-{task.id}-step-{current_step.step_index}",
                        tool_name=tool.name,
                        parameters=parameters,
                        risk_tier=tool.risk_tier.value,
                        reason=confirmation_reason,
                        diff_preview=None,
                    )
                    self._pending_proposals[task.id] = proposal

                    task.state = "waiting_for_confirmation"
                    current_step.state = "waiting_for_confirmation"
                    await session.commit()

                    schema = self._model_to_schema(task)
                    schema.requires_confirmation = True
                    schema.confirmation_proposal = proposal
                    return schema

                # Reset confirmation flag for next steps
                step_user_confirmed = False

                # Mark step as running
                current_step.state = "running"
                await session.commit()

            # Execute the step with retry and duplicate side effect prevention
            step_success = False
            step_error = None
            step_summary = None
            step_data = None
            step_duration_ms = 0.0

            while True:
                # Refresh step object for retry iteration
                async with self.session_factory() as session:
                    result = await session.execute(
                        select(TaskModel).options(selectinload(TaskModel.steps)).where(TaskModel.id == task_id)
                    )
                    task = result.scalar_one()
                    current_step = task.steps[task.current_step_index]

                    # DUPLICATE SIDE EFFECT CHECK:
                    # If this is a retry and a side effect has already occurred, do NOT retry!
                    if current_step.retry_count > 0 and current_step.side_effect_occurred:
                        step_error = (
                            f"Step '{current_step.title}' failed and side effects already occurred. "
                            "Duplicate action prevented; automatic retry blocked."
                        )
                        current_step.state = "failed"
                        current_step.error_message = step_error
                        task.state = "failed"
                        task.error_message = step_error
                        task.completed_at = datetime.now(timezone.utc)
                        task.final_report = self._build_final_report(task)
                        await session.commit()
                        return self._model_to_schema(task)

                    # Increment tool calls counter
                    task.total_tool_calls += 1
                    await session.commit()

                # Execute with timeout
                step_start = time.time()
                try:
                    exec_result = await asyncio.wait_for(
                        self.tool_registry.execute_tool(
                            name=current_step.tool_name,
                            parameters=parameters,
                            context=ctx,
                            audit_logger=self.audit_logger,
                        ),
                        timeout=settings.task_step_timeout_seconds,
                    )
                    step_duration_ms += (time.time() - step_start) * 1000.0

                    # Verify tool outcome
                    if exec_result.success:
                        # Success verification
                        step_success = True
                        step_summary = exec_result.summary
                        step_data = exec_result.data
                        # If tool causes side effects, mark side_effect_occurred
                        if self.is_side_effect_tool(current_step.tool_name):
                            async with self.session_factory() as session:
                                await session.execute(
                                    update(TaskStepModel)
                                    .where(TaskStepModel.id == current_step.id)
                                    .values(side_effect_occurred=True)
                                )
                                await session.commit()
                        break
                    else:
                        step_error = exec_result.error or exec_result.summary
                except asyncio.TimeoutError:
                    step_duration_ms += (time.time() - step_start) * 1000.0
                    step_error = f"Step timed out after {settings.task_step_timeout_seconds}s"
                except Exception as ex:
                    step_duration_ms += (time.time() - step_start) * 1000.0
                    step_error = str(ex)

                # If failed, check retry limit
                async with self.session_factory() as session:
                    result = await session.execute(
                        select(TaskStepModel).where(TaskStepModel.id == current_step.id)
                    )
                    db_step = result.scalar_one()
                    if db_step.retry_count < db_step.max_retries and not db_step.side_effect_occurred:
                        db_step.retry_count += 1
                        logger.warning(
                            "Step %d ('%s') failed with error '%s'. Retrying (%d/%d)...",
                            db_step.step_index + 1,
                            db_step.title,
                            step_error,
                            db_step.retry_count,
                            db_step.max_retries,
                        )
                        await session.commit()
                        # Short backoff before retry
                        await asyncio.sleep(0.1)
                        continue
                    else:
                        # Retries exhausted or non-retryable
                        step_success = False
                        break

            # Process step outcome in DB
            async with self.session_factory() as session:
                result = await session.execute(
                    select(TaskModel).options(selectinload(TaskModel.steps)).where(TaskModel.id == task_id)
                )
                task = result.scalar_one()
                current_step = task.steps[task.current_step_index]
                current_step.duration_ms = step_duration_ms

                if step_success:
                    current_step.state = "completed"
                    current_step.result_summary = step_summary
                    current_step.result_data_json = json.dumps(step_data) if step_data is not None else None
                    task.current_step_index += 1
                    await session.commit()
                else:
                    # Step failed -> task failed
                    current_step.state = "failed"
                    current_step.error_message = step_error
                    task.state = "failed"
                    task.error_message = f"Step {current_step.step_index + 1} ('{current_step.title}') failed: {step_error}"
                    task.completed_at = datetime.now(timezone.utc)
                    task.final_report = self._build_final_report(task)
                    await session.commit()
                    return self._model_to_schema(task)

    def _build_final_report(self, task: TaskModel) -> str:
        """Produce a concise, structured final report of the task outcome."""
        status_icons = {
            "completed": "✓ Completed",
            "failed": "✗ Failed",
            "cancelled": "⊘ Cancelled",
            "running": "↻ Running",
            "waiting_for_confirmation": "⏳ Awaiting Review",
            "planned": "☐ Planned",
        }

        icon = status_icons.get(task.state, task.state.capitalize())
        lines = [
            f"### Task Report: {task.title}",
            f"**Status**: {icon}",
            f"**Total Tool Calls**: {task.total_tool_calls} (limit: {task.max_total_tool_calls})",
            f"**Progress**: {task.current_step_index} / {task.total_steps} steps finished",
            "",
            "#### Step Execution Details:",
        ]

        for s in task.steps:
            st_icon = "✓" if s.state == "completed" else "✗" if s.state == "failed" else "-"
            line = f"{s.step_index + 1}. [{st_icon}] **{s.title}** (`{s.tool_name}`)"
            if s.state == "completed":
                summary = s.result_summary or "Executed successfully"
                line += f": {summary} ({s.duration_ms:.1f}ms)"
            elif s.state == "failed":
                err = s.error_message or "Unknown failure"
                line += f": Error - {err}"
            elif s.state == "cancelled":
                line += ": Cancelled"
            else:
                line += f": {s.state}"

            if s.retry_count > 0:
                line += f" (retries: {s.retry_count})"
            lines.append(line)

        if task.state == "failed" and task.error_message:
            lines.extend(["", f"> [!WARNING]\n> **Failure Cause**: {task.error_message}"])
        elif task.state == "cancelled":
            lines.extend(["", "> [!NOTE]\n> Task execution was cancelled by user request."])

        return "\n".join(lines)

    async def _load_task_schema(self, session: AsyncSession, task_id: str) -> Optional[TaskSchema]:
        """Load task and construct TaskSchema with step representations and pending proposals."""
        result = await session.execute(
            select(TaskModel).options(selectinload(TaskModel.steps)).where(TaskModel.id == task_id)
        )
        task = result.scalar_one_or_none()
        if not task:
            return None
        return self._model_to_schema(task)

    def _model_to_schema(self, task: TaskModel) -> TaskSchema:
        """Convert a TaskModel into a TaskSchema."""
        steps_schemas = []
        for s in task.steps:
            params = {}
            if s.parameters_json:
                try:
                    params = json.loads(s.parameters_json)
                except Exception:
                    pass

            data = None
            if s.result_data_json:
                try:
                    data = json.loads(s.result_data_json)
                except Exception:
                    pass

            steps_schemas.append(
                TaskStepSchema(
                    id=s.id,
                    step_index=s.step_index,
                    title=s.title,
                    tool_name=s.tool_name,
                    parameters=params,
                    state=s.state,
                    retry_count=s.retry_count,
                    max_retries=s.max_retries,
                    side_effect_occurred=s.side_effect_occurred,
                    result_summary=s.result_summary,
                    result_data=data,
                    error_message=s.error_message,
                    duration_ms=s.duration_ms,
                )
            )

        proposal = self._pending_proposals.get(task.id)
        return TaskSchema(
            id=task.id,
            session_id=task.session_id,
            title=task.title,
            description=task.description,
            state=task.state,
            current_step_index=task.current_step_index,
            total_steps=task.total_steps,
            steps=steps_schemas,
            total_tool_calls=task.total_tool_calls,
            max_total_tool_calls=task.max_total_tool_calls,
            error_message=task.error_message,
            final_report=task.final_report,
            requires_confirmation=proposal is not None,
            confirmation_proposal=proposal,
            created_at=task.created_at.isoformat(),
            updated_at=task.updated_at.isoformat(),
            completed_at=task.completed_at.isoformat() if task.completed_at else None,
        )
