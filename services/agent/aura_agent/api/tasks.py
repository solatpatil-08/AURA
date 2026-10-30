import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from aura_agent.models.schemas import (
    CreateTaskPlanRequest,
    CreateTaskRequest,
    TaskCancelRequest,
    TaskConfirmationRequest,
    TaskPlanSchema,
    TaskSchema,
)
from aura_agent.services.orchestrator import PlanValidationError, TaskOrchestrator

logger = logging.getLogger("aura.api.tasks")
router = APIRouter(prefix="/api/tasks", tags=["Task Orchestration"])


def get_orchestrator(request: Request) -> TaskOrchestrator:
    return request.app.state.orchestrator


@router.post("/plan", response_model=TaskPlanSchema)
async def create_task_plan(
    req: CreateTaskPlanRequest,
    orchestrator: TaskOrchestrator = Depends(get_orchestrator),
):
    """Convert a natural language user request into a structured, validated task plan."""
    try:
        plan = await orchestrator.generate_plan_from_request(req)
        return plan
    except PlanValidationError as pe:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Plan validation failed: {pe}",
        )
    except Exception as e:
        logger.error("Failed to generate task plan: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate task plan: {e}",
        )


@router.post("", response_model=TaskSchema, status_code=status.HTTP_201_CREATED)
async def create_task(
    req: CreateTaskRequest,
    orchestrator: TaskOrchestrator = Depends(get_orchestrator),
):
    """Create a new multi-step task and validate its plan before persistence."""
    try:
        task = await orchestrator.create_task(req)
        return task
    except PlanValidationError as pe:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid task plan: {pe}",
        )
    except Exception as e:
        logger.error("Error creating task: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error creating task: {e}",
        )


@router.get("", response_model=List[TaskSchema])
async def list_tasks(
    session_id: Optional[str] = Query(None, description="Filter by session ID"),
    state: Optional[str] = Query(None, description="Filter by state"),
    limit: int = Query(50, ge=1, le=100),
    orchestrator: TaskOrchestrator = Depends(get_orchestrator),
):
    """List orchestrated tasks with live execution status."""
    return await orchestrator.list_tasks(session_id=session_id, state=state, limit=limit)


@router.get("/{task_id}", response_model=TaskSchema)
async def get_task(
    task_id: str,
    orchestrator: TaskOrchestrator = Depends(get_orchestrator),
):
    """Get live details, step progression, and active proposals for a specific task."""
    task = await orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with ID '{task_id}' not found.",
        )
    return task


@router.post("/{task_id}/execute", response_model=TaskSchema)
async def execute_task(
    task_id: str,
    orchestrator: TaskOrchestrator = Depends(get_orchestrator),
):
    """Execute or resume an orchestrated task step-by-step."""
    task = await orchestrator.get_task(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with ID '{task_id}' not found.",
        )

    try:
        updated_task = await orchestrator.execute_task(task_id)
        return updated_task
    except Exception as e:
        logger.error("Error executing task %s: %s", task_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error executing task: {e}",
        )


@router.post("/{task_id}/confirm", response_model=TaskSchema)
async def confirm_task_step(
    task_id: str,
    req: TaskConfirmationRequest,
    orchestrator: TaskOrchestrator = Depends(get_orchestrator),
):
    """Submit user approval or rejection for a consequential step requiring confirmation."""
    try:
        return await orchestrator.confirm_task_step(task_id, req)
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except Exception as e:
        logger.error("Error confirming task step %s: %s", task_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error confirming task step: {e}",
        )


@router.post("/{task_id}/cancel", response_model=TaskSchema)
async def cancel_task(
    task_id: str,
    req: TaskCancelRequest = TaskCancelRequest(),
    orchestrator: TaskOrchestrator = Depends(get_orchestrator),
):
    """Cancel an active, waiting, or planned task."""
    try:
        return await orchestrator.cancel_task(task_id, reason=req.reason or "Cancelled by user")
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(ve),
        )
    except Exception as e:
        logger.error("Error cancelling task %s: %s", task_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error cancelling task: {e}",
        )
