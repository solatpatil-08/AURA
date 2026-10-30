import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from aura_agent.models.schemas import (
    MemorySchema,
    CreateMemoryRequest,
    UpdateMemoryRequest,
    MemorySearchRequest,
    MemorySearchHit,
    MemoryClearRequest,
)
from aura_agent.services.memory import MemoryService, MemorySecurityError

logger = logging.getLogger("aura.api.memory")
router = APIRouter(prefix="/api/memory", tags=["Persistent Memory"])


def get_memory_service(request: Request) -> MemoryService:
    return request.app.state.memory_service


def _model_to_schema(m) -> MemorySchema:
    return MemorySchema(
        id=m.id,
        category=m.category,
        key=m.key,
        content=m.content,
        source_session_id=m.source_session_id,
        confidence=m.confidence,
        access_count=m.access_count,
        last_accessed_at=m.last_accessed_at.isoformat() if m.last_accessed_at else None,
        created_at=m.created_at.isoformat(),
        updated_at=m.updated_at.isoformat(),
        expires_at=m.expires_at.isoformat() if m.expires_at else None,
        is_pinned=m.is_pinned,
        metadata_json=m.metadata_json,
    )


@router.get("", response_model=List[MemorySchema])
async def list_memories(
    category: Optional[str] = Query(None, description="Filter by memory category"),
    query: Optional[str] = Query(None, description="Search query substring"),
    is_pinned: Optional[bool] = Query(None, description="Filter by pinned status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    memory_service: MemoryService = Depends(get_memory_service),
) -> List[MemorySchema]:
    """List persistent structured memories with optional filters."""
    memories = await memory_service.list_memories(
        category=category,
        query=query,
        is_pinned=is_pinned,
        limit=limit,
        offset=offset,
    )
    return [_model_to_schema(m) for m in memories]


@router.post("", response_model=MemorySchema, status_code=status.HTTP_201_CREATED)
async def create_memory(
    req: CreateMemoryRequest,
    memory_service: MemoryService = Depends(get_memory_service),
) -> MemorySchema:
    """Create a new persistent structured memory item."""
    try:
        memory = await memory_service.create_memory(
            category=req.category,
            content=req.content,
            key=req.key,
            source_session_id=req.source_session_id,
            confidence=req.confidence,
            is_pinned=req.is_pinned,
            expires_in_days=req.expires_in_days,
        )
        return _model_to_schema(memory)
    except MemorySecurityError as sec_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(sec_err),
        )
    except Exception as exc:
        logger.error("Failed to create memory: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create memory: {exc}",
        )


@router.get("/{memory_id}", response_model=MemorySchema)
async def get_memory(
    memory_id: str,
    memory_service: MemoryService = Depends(get_memory_service),
) -> MemorySchema:
    """Retrieve an individual memory item by ID."""
    memory = await memory_service.get_memory(memory_id)
    if not memory:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory item '{memory_id}' not found.",
        )
    return _model_to_schema(memory)


@router.put("/{memory_id}", response_model=MemorySchema)
async def update_memory(
    memory_id: str,
    req: UpdateMemoryRequest,
    memory_service: MemoryService = Depends(get_memory_service),
) -> MemorySchema:
    """Correct or update an existing memory item."""
    try:
        memory = await memory_service.update_memory(
            memory_id=memory_id,
            category=req.category,
            key=req.key,
            content=req.content,
            confidence=req.confidence,
            is_pinned=req.is_pinned,
            expires_in_days=req.expires_in_days,
        )
        if not memory:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Memory item '{memory_id}' not found.",
            )
        return _model_to_schema(memory)
    except MemorySecurityError as sec_err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(sec_err),
        )


@router.delete("/{memory_id}")
async def delete_memory(
    memory_id: str,
    memory_service: MemoryService = Depends(get_memory_service),
):
    """Delete a specific memory item."""
    deleted = await memory_service.delete_memory(memory_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Memory item '{memory_id}' not found.",
        )
    return {"deleted": True, "id": memory_id}


@router.post("/clear")
async def clear_memories(
    req: MemoryClearRequest,
    memory_service: MemoryService = Depends(get_memory_service),
):
    """Purge all memories or all memories within a specific category."""
    if not req.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation flag 'confirm: true' is required to clear memories.",
        )

    count = await memory_service.clear_memories(category=req.category)
    return {"cleared_count": count, "category": req.category}


@router.post("/search", response_model=List[MemorySearchHit])
async def search_memories(
    req: MemorySearchRequest,
    memory_service: MemoryService = Depends(get_memory_service),
) -> List[MemorySearchHit]:
    """Retrieve only relevant memories scored against a specific query."""
    hits = await memory_service.search_relevant_memories(
        query=req.query,
        limit=req.limit,
        category=req.category,
    )
    return [
        MemorySearchHit(memory=_model_to_schema(mem), relevance_score=score)
        for mem, score in hits
    ]


@router.post("/retention/cleanup")
async def run_retention_cleanup(
    memory_service: MemoryService = Depends(get_memory_service),
):
    """Manually invoke the retention cleanup policy to remove expired memories."""
    purged = await memory_service.apply_retention_policy()
    return {"purged_count": purged}
