import json
import pytest
from unittest.mock import AsyncMock, patch

from aura_agent.models.schemas import (
    CreateTaskPlanRequest,
    CreateTaskRequest,
    TaskCancelRequest,
    TaskConfirmationRequest,
    TaskPlanSchema,
    TaskStepDefinition,
    ToolExecutionResponse,
)
from aura_agent.services.orchestrator import PlanValidationError, TaskOrchestrator
from aura_agent.tools.base import RiskTier


@pytest.mark.asyncio
async def test_plan_validation_and_rejection(app_instance):
    """Verify pre-execution plan validation rejects invalid tools, bad parameters, and empty plans."""
    orchestrator: TaskOrchestrator = app_instance.state.orchestrator

    # 1. Reject empty steps
    with pytest.raises(PlanValidationError, match="at least one step"):
        orchestrator.validate_plan(
            CreateTaskRequest(title="Empty Task", steps=[])
        )

    # 2. Reject unknown tool
    with pytest.raises(PlanValidationError, match="references unknown tool 'unregistered_hack_tool'"):
        orchestrator.validate_plan(
            CreateTaskRequest(
                title="Bad Tool Task",
                steps=[
                    TaskStepDefinition(
                        title="Run unknown tool",
                        tool_name="unregistered_hack_tool",
                        parameters={},
                    )
                ],
            )
        )

    # 3. Reject invalid parameter types (e.g. read_file requires relative_path)
    with pytest.raises(PlanValidationError, match="invalid parameters for 'read_file'"):
        orchestrator.validate_plan(
            CreateTaskRequest(
                title="Invalid Params Task",
                steps=[
                    TaskStepDefinition(
                        title="Read without path",
                        tool_name="read_file",
                        parameters={"wrong_field": 123},
                    )
                ],
            )
        )

    # 4. Valid plan passes validation
    valid_plan = CreateTaskRequest(
        title="Valid Multi-Step Task",
        steps=[
            TaskStepDefinition(
                title="Get current time",
                tool_name="get_current_time",
                parameters={},
            ),
            TaskStepDefinition(
                title="List files in root",
                tool_name="list_files",
                parameters={"relative_path": "."},
            ),
        ],
    )
    # Should not raise
    orchestrator.validate_plan(valid_plan)


@pytest.mark.asyncio
async def test_successful_multi_step_task(app_instance):
    """Test ordered execution of a 2-step task, updating step states, and generating a final report."""
    orchestrator: TaskOrchestrator = app_instance.state.orchestrator

    create_req = CreateTaskRequest(
        title="Time and File Check",
        description="Check system clock and list workspace files",
        steps=[
            TaskStepDefinition(
                title="Check current time",
                tool_name="get_current_time",
                parameters={},
            ),
            TaskStepDefinition(
                title="Inspect directory",
                tool_name="list_files",
                parameters={"relative_path": "."},
            ),
        ],
    )

    task = await orchestrator.create_task(create_req)
    assert task.state == "planned"
    assert task.total_steps == 2
    assert task.current_step_index == 0

    # Execute
    finished_task = await orchestrator.execute_task(task.id)
    assert finished_task.state == "completed"
    assert finished_task.current_step_index == 2
    assert finished_task.total_tool_calls == 2
    assert finished_task.completed_at is not None

    # Step verification
    assert finished_task.steps[0].state == "completed"
    assert finished_task.steps[0].result_summary is not None
    assert finished_task.steps[1].state == "completed"
    assert finished_task.steps[1].result_summary is not None

    # Final report verification
    assert finished_task.final_report is not None
    assert "### Task Report: Time and File Check" in finished_task.final_report
    assert "✓ Completed" in finished_task.final_report
    assert "Check current time" in finished_task.final_report
    assert "Inspect directory" in finished_task.final_report


@pytest.mark.asyncio
async def test_failed_task_and_stop_workflow(app_instance):
    """Test that a failing step stops subsequent steps and marks the task as failed."""
    orchestrator: TaskOrchestrator = app_instance.state.orchestrator

    create_req = CreateTaskRequest(
        title="Failing Workflow",
        steps=[
            TaskStepDefinition(
                title="Read non-existent file",
                tool_name="read_file",
                parameters={"relative_path": "does_not_exist_file.txt"},
                max_retries=1,
            ),
            TaskStepDefinition(
                title="Should not run",
                tool_name="get_current_time",
                parameters={},
            ),
        ],
    )

    task = await orchestrator.create_task(create_req)
    finished = await orchestrator.execute_task(task.id)

    assert finished.state == "failed"
    assert finished.current_step_index == 0
    assert finished.steps[0].state == "failed"
    assert "does_not_exist_file.txt" in (finished.steps[0].error_message or "")
    # Second step must remain pending / not executed
    assert finished.steps[1].state == "pending"
    assert "Failure Cause" in finished.final_report


@pytest.mark.asyncio
async def test_consequential_action_confirmation_and_rejection(app_instance):
    """Test that consequential steps request confirmation and stop on user rejection."""
    orchestrator: TaskOrchestrator = app_instance.state.orchestrator

    # create_note under request-review requires confirmation
    create_req = CreateTaskRequest(
        title="Consequential Note Task",
        steps=[
            TaskStepDefinition(
                title="Create important note",
                tool_name="create_note",
                parameters={"title": "test_note", "content": "Important confidential content"},
            ),
            TaskStepDefinition(
                title="Get time after note",
                tool_name="get_current_time",
                parameters={},
            ),
        ],
    )

    task = await orchestrator.create_task(create_req)
    paused = await orchestrator.execute_task(task.id)

    # Must pause for confirmation
    assert paused.state == "waiting_for_confirmation"
    assert paused.requires_confirmation is True
    assert paused.confirmation_proposal is not None
    assert paused.confirmation_proposal.tool_name == "create_note"
    assert paused.steps[0].state == "waiting_for_confirmation"

    # 1. User Rejects
    rejected = await orchestrator.confirm_task_step(
        task.id,
        TaskConfirmationRequest(approved=False, guidance="User declined note creation"),
    )
    assert rejected.state == "failed"
    assert "User declined note creation" in rejected.error_message
    assert rejected.steps[0].state == "failed"
    assert rejected.steps[1].state == "pending"


@pytest.mark.asyncio
async def test_consequential_action_confirmation_and_approval(app_instance):
    """Test that approving a consequential step allows execution to proceed and complete."""
    orchestrator: TaskOrchestrator = app_instance.state.orchestrator

    create_req = CreateTaskRequest(
        title="Approved Consequential Task",
        steps=[
            TaskStepDefinition(
                title="Create project note",
                tool_name="create_note",
                parameters={"title": "approved_note", "content": "Hello approved world"},
            ),
            TaskStepDefinition(
                title="Get time after note",
                tool_name="get_current_time",
                parameters={},
            ),
        ],
    )

    task = await orchestrator.create_task(create_req)
    paused = await orchestrator.execute_task(task.id)
    assert paused.state == "waiting_for_confirmation"

    # 2. User Approves
    resumed = await orchestrator.confirm_task_step(
        task.id,
        TaskConfirmationRequest(approved=True),
    )
    assert resumed.state == "completed"
    assert resumed.current_step_index == 2
    assert resumed.steps[0].state == "completed"
    assert resumed.steps[0].side_effect_occurred is True
    assert resumed.steps[1].state == "completed"


@pytest.mark.asyncio
async def test_task_cancellation(app_instance):
    """Test cancellation of a planned or running task."""
    orchestrator: TaskOrchestrator = app_instance.state.orchestrator

    create_req = CreateTaskRequest(
        title="Cancellable Task",
        steps=[
            TaskStepDefinition(
                title="Check time",
                tool_name="get_current_time",
                parameters={},
            ),
            TaskStepDefinition(
                title="Check files",
                tool_name="list_files",
                parameters={"relative_path": "."},
            ),
        ],
    )

    task = await orchestrator.create_task(create_req)
    assert task.state == "planned"

    cancelled = await orchestrator.cancel_task(task.id, reason="User cancelled prior to launch")
    assert cancelled.state == "cancelled"
    assert "User cancelled" in cancelled.error_message
    assert cancelled.steps[0].state == "cancelled"
    assert cancelled.steps[1].state == "cancelled"


@pytest.mark.asyncio
async def test_duplicate_side_effect_prevention(app_instance):
    """Test that a step with side effects already occurred is never retried automatically."""
    orchestrator: TaskOrchestrator = app_instance.state.orchestrator

    create_req = CreateTaskRequest(
        title="Side Effect Safety Test",
        steps=[
            TaskStepDefinition(
                title="Create note with side effect failure simulation",
                tool_name="create_note",
                parameters={"title": "side_effect_note", "content": "Safe content"},
                max_retries=2,
            )
        ],
    )

    task = await orchestrator.create_task(create_req)

    # First approve confirmation
    paused = await orchestrator.execute_task(task.id)
    assert paused.state == "waiting_for_confirmation"

    # Simulate an error occurring *after* the note was created on disk
    # We mock execute_tool to fail on retry
    original_execute = orchestrator.tool_registry.execute_tool
    calls = []

    async def mock_exec(name, parameters, context, audit_logger):
        calls.append(name)
        if len(calls) == 1:
            # First execution: tool writes note but raises an error or returns failure
            res = await original_execute(name, parameters, context, audit_logger)
            # Mark side effect occurred and pretend verification failed
            return ToolExecutionResponse(
                success=False,
                error="Post-write verification check failed",
                summary="Failed after writing note",
                risk_tier=RiskTier.TIER_2_MONITORED_WRITE.value,
            )
        return await original_execute(name, parameters, context, audit_logger)

    with patch.object(orchestrator.tool_registry, "execute_tool", side_effect=mock_exec):
        # Manually set side_effect_occurred on step to test prevention gate
        from aura_agent.models.db import TaskStepModel
        from sqlalchemy import update

        async with orchestrator.session_factory() as s:
            await s.execute(
                update(TaskStepModel)
                .where(TaskStepModel.task_id == task.id)
                .values(side_effect_occurred=True, retry_count=1)
            )
            await s.commit()

        # Resuming execution must immediately abort retry due to side effect prevention!
        result = await orchestrator.execute_task(task.id, step_user_confirmed=True)
        assert result.state == "failed"
        assert "Duplicate action prevented" in result.error_message


@pytest.mark.asyncio
async def test_total_tool_calls_cap_enforcement(app_instance):
    """Test that tasks exceeding max_total_tool_calls are halted with limit error."""
    orchestrator: TaskOrchestrator = app_instance.state.orchestrator

    create_req = CreateTaskRequest(
        title="Cap Exceeded Task",
        max_total_tool_calls=2,  # Cap at 2 tool calls
        steps=[
            TaskStepDefinition(title="Time 1", tool_name="get_current_time", parameters={}),
            TaskStepDefinition(title="Time 2", tool_name="get_current_time", parameters={}),
            TaskStepDefinition(title="Time 3", tool_name="get_current_time", parameters={}),
        ],
    )

    task = await orchestrator.create_task(create_req)
    result = await orchestrator.execute_task(task.id)

    assert result.state == "failed"
    assert "Total tool call limit exceeded" in result.error_message


@pytest.mark.asyncio
async def test_task_api_endpoints(client):
    """Test the full REST API lifecycle for task planning, creation, execution, and inspection."""
    # 1. Create task
    create_payload = {
        "title": "API Multi-Step Task",
        "description": "Created through REST endpoint",
        "steps": [
            {
                "title": "Get Time",
                "tool_name": "get_current_time",
                "parameters": {},
            },
            {
                "title": "List Root Files",
                "tool_name": "list_files",
                "parameters": {"relative_path": "."},
            },
        ],
    }

    create_resp = await client.post("/api/tasks", json=create_payload)
    assert create_resp.status_code == 201
    task_data = create_resp.json()
    task_id = task_data["id"]
    assert task_data["state"] == "planned"
    assert len(task_data["steps"]) == 2

    # 2. Get task by ID
    get_resp = await client.get(f"/api/tasks/{task_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == task_id

    # 3. List tasks
    list_resp = await client.get("/api/tasks")
    assert list_resp.status_code == 200
    tasks = list_resp.json()
    assert any(t["id"] == task_id for t in tasks)

    # 4. Execute task
    exec_resp = await client.post(f"/api/tasks/{task_id}/execute")
    assert exec_resp.status_code == 200
    executed_data = exec_resp.json()
    assert executed_data["state"] == "completed"
    assert executed_data["current_step_index"] == 2
    assert "### Task Report: API Multi-Step Task" in executed_data["final_report"]

    # 5. Cancel endpoint on a new task
    new_resp = await client.post("/api/tasks", json=create_payload)
    new_id = new_resp.json()["id"]
    cancel_resp = await client.post(f"/api/tasks/{new_id}/cancel", json={"reason": "Testing cancellation API"})
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["state"] == "cancelled"


@pytest.mark.asyncio
async def test_task_timeout_handling(app_instance):
    """Test that a step execution exceeding timeout fails gracefully and marks task failed."""
    import asyncio
    orchestrator: TaskOrchestrator = app_instance.state.orchestrator

    create_req = CreateTaskRequest(
        title="Timeout Task Test",
        steps=[
            TaskStepDefinition(
                title="Slow Tool Step",
                tool_name="get_current_time",
                parameters={},
                max_retries=0,
            )
        ],
    )

    task = await orchestrator.create_task(create_req)

    # Mock tool execution to exceed timeout
    async def slow_exec(*args, **kwargs):
        await asyncio.sleep(0.5)
        return ToolExecutionResponse(success=True, summary="Too late", risk_tier="TIER_1_READ_ONLY")

    with patch.object(orchestrator.tool_registry, "execute_tool", side_effect=slow_exec):
        with patch("aura_agent.services.orchestrator.settings.task_step_timeout_seconds", 0.05):
            res = await orchestrator.execute_task(task.id)
            assert res.state == "failed"
            assert "timed out" in res.error_message.lower()
            assert res.steps[0].state == "failed"
