import json
import logging
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from aura_agent.config import settings
from aura_agent.models.schemas import (
    ChatRequest,
    ChatResponse,
    MessageSchema,
    SessionSchema,
)
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

logger = logging.getLogger("aura.chat")
router = APIRouter(prefix="/api", tags=["Chat & Sessions"])


def get_ollama_client(request: Request) -> OllamaClient:
    return request.app.state.ollama_client


def get_history_service(request: Request) -> ConversationHistoryService:
    return request.app.state.history_service


def get_agent_loop(request: Request) -> Optional[AgentLoop]:
    return getattr(request.app.state, "agent_loop", None)


def get_memory_service(request: Request) -> Optional[MemoryService]:
    return getattr(request.app.state, "memory_service", None)


@router.post("/chat", response_model=ChatResponse)
async def post_chat(
    req: ChatRequest,
    ollama_client: OllamaClient = Depends(get_ollama_client),
    history_service: ConversationHistoryService = Depends(get_history_service),
    agent_loop: Optional[AgentLoop] = Depends(get_agent_loop),
    memory_service: Optional[MemoryService] = Depends(get_memory_service),
):
    """Execute local chat inference using Ollama with persistence and context preservation."""
    target_model = req.model_override or settings.model_name

    # 1. Fetch or initialize conversation session in SQLite
    session = await history_service.get_or_create_session(
        session_id=req.session_id,
        initial_title=req.message[:40] + ("..." if len(req.message) > 40 else ""),
    )
    session_id = session.id

    # 2. Persist the user's incoming message
    await history_service.save_message(
        session_id=session_id,
        role="user",
        content=req.message,
        model=None,
    )

    # 3. Assemble chronological conversation context for follow-up turns
    context_messages = await history_service.build_conversation_context(
        session_id=session_id,
        new_user_message=req.message,
        max_turns=10,
    )

    # 4. Phase 7: Retrieve selective relevant memories for the prompt (never the whole database)
    effective_system_prompt = req.system_prompt
    if settings.memory_enabled and memory_service:
        try:
            relevant_hits = await memory_service.search_relevant_memories(
                query=req.message,
                limit=settings.memory_max_injected,
            )
            memory_block = memory_service.format_relevant_memories_prompt(relevant_hits)
            if memory_block:
                effective_system_prompt = (
                    f"{req.system_prompt}\n\n{memory_block}"
                    if req.system_prompt
                    else memory_block
                )
        except Exception as mem_err:
            logger.warning("Selective memory retrieval failed: %s", mem_err)

    # 5. Handle streaming response if requested
    if req.stream:
        async def event_generator():
            full_assistant_content = []
            try:
                async for delta in ollama_client.chat_stream(
                    messages=context_messages,
                    model=target_model,
                    system_prompt=effective_system_prompt,
                ):
                    full_assistant_content.append(delta)
                    chunk_data = {
                        "session_id": session_id,
                        "delta": delta,
                        "done": False,
                        "model": target_model,
                    }
                    yield f"data: {json.dumps(chunk_data)}\n\n"

                # Persist completed assistant message to SQLite
                full_text = "".join(full_assistant_content)
                saved_msg = await history_service.save_message(
                    session_id=session_id,
                    role="assistant",
                    content=full_text,
                    model=target_model,
                )

                final_chunk = {
                    "session_id": session_id,
                    "message_id": saved_msg.id,
                    "delta": "",
                    "done": True,
                    "model": target_model,
                }
                yield f"data: {json.dumps(final_chunk)}\n\n"

            except OllamaConnectionError as exc:
                err_data = {"error": str(exc), "code": "OLLAMA_UNAVAILABLE", "done": True}
                yield f"data: {json.dumps(err_data)}\n\n"
            except OllamaModelNotFoundError as exc:
                err_data = {"error": str(exc), "code": "MODEL_NOT_FOUND", "done": True}
                yield f"data: {json.dumps(err_data)}\n\n"
            except OllamaTimeoutError as exc:
                err_data = {"error": str(exc), "code": "TIMEOUT", "done": True}
                yield f"data: {json.dumps(err_data)}\n\n"
            except Exception as exc:
                err_data = {"error": f"Internal inference error: {exc}", "code": "INTERNAL_ERROR", "done": True}
                yield f"data: {json.dumps(err_data)}\n\n"

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    # 5. Non-streaming execution with Agent Loop & Tool Calling
    try:
        if agent_loop:
            turn_result = await agent_loop.run_turn(
                session_id=session_id,
                messages=context_messages,
                model=target_model,
                system_prompt=effective_system_prompt,
                ollama_client=ollama_client,
            )
            content = turn_result.get("content", "")
            requires_conf = turn_result.get("requires_confirmation", False)
            proposal = turn_result.get("confirmation_proposal")
            actions_executed = turn_result.get("tool_calls_executed")
            total_duration_ms = turn_result.get("total_duration_ms")
            eval_count = turn_result.get("eval_count")
        else:
            response_dict = await ollama_client.chat(
                messages=context_messages,
                model=target_model,
                system_prompt=effective_system_prompt,
            )
            content = response_dict.get("content", "")
            requires_conf = False
            proposal = None
            actions_executed = None
            total_duration_ms = response_dict.get("total_duration_ms")
            eval_count = response_dict.get("eval_count")

        # Persist assistant reply in SQLite
        saved_msg = await history_service.save_message(
            session_id=session_id,
            role="assistant",
            content=content,
            model=target_model,
        )

        return ChatResponse(
            session_id=session_id,
            message_id=saved_msg.id,
            role="assistant",
            content=content,
            model=target_model,
            total_duration_ms=total_duration_ms,
            eval_count=eval_count,
            requires_confirmation=requires_conf,
            confirmation_proposal=proposal,
            tool_calls_executed=actions_executed,
        )

    except OllamaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except OllamaModelNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except OllamaTimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=str(exc),
        ) from exc
    except OllamaError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ollama error: {exc}",
        ) from exc


@router.get("/sessions", response_model=List[SessionSchema])
async def list_sessions(
    limit: int = 20,
    history_service: ConversationHistoryService = Depends(get_history_service),
):
    """Retrieve list of past conversation sessions stored in SQLite."""
    return await history_service.get_all_sessions(limit=limit)


@router.get("/sessions/{session_id}/messages", response_model=List[MessageSchema])
async def get_session_messages(
    session_id: str,
    limit: int = 50,
    history_service: ConversationHistoryService = Depends(get_history_service),
):
    """Fetch chronological message history for a given session."""
    return await history_service.get_session_messages(session_id=session_id, limit=limit)


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    history_service: ConversationHistoryService = Depends(get_history_service),
):
    """Delete a conversation session and all its messages."""
    deleted = await history_service.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted", "session_id": session_id}
