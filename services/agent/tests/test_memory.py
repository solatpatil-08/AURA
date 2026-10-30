import pytest
import pytest_asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from aura_agent.models.db import MemoryModel
from aura_agent.services.memory import MemoryService, MemorySecurityError
from aura_agent.tools.base import ExecutionContext, RiskTier
from aura_agent.tools.builtin.save_memory import SaveMemoryTool, SaveMemoryArgs
from aura_agent.tools.builtin.recall_memory import RecallMemoryTool, RecallMemoryArgs
from aura_agent.tools.builtin.forget_memory import ForgetMemoryTool, ForgetMemoryArgs


@pytest.fixture
def memory_service(in_memory_db):
    """Provide a MemoryService connected to an isolated in-memory SQLite database."""
    return MemoryService(in_memory_db)


@pytest.mark.asyncio
async def test_memory_crud_lifecycle(memory_service):
    """Test standard creation, retrieval, updating, and deletion of persistent memories."""
    # 1. Create
    mem = await memory_service.create_memory(
        category="preference",
        key="editor",
        content="User prefers Neovim and VS Code.",
        confidence=1.0,
        is_pinned=True,
    )
    assert mem.id is not None
    assert mem.category == "preference"
    assert mem.key == "editor"
    assert mem.content == "User prefers Neovim and VS Code."
    assert mem.is_pinned is True

    # 2. Get by ID
    fetched = await memory_service.get_memory(mem.id)
    assert fetched is not None
    assert fetched.id == mem.id
    assert fetched.content == mem.content

    # 3. List
    listed = await memory_service.list_memories(category="preference")
    assert len(listed) == 1
    assert listed[0].id == mem.id

    # 4. Update / Correct
    updated = await memory_service.update_memory(
        memory_id=mem.id,
        content="User prefers Cursor and VS Code.",
        key="primary_editor",
    )
    assert updated is not None
    assert updated.content == "User prefers Cursor and VS Code."
    assert updated.key == "primary_editor"

    # 5. Delete
    deleted = await memory_service.delete_memory(mem.id)
    assert deleted is True

    # Verify deletion
    post_delete = await memory_service.get_memory(mem.id)
    assert post_delete is None


@pytest.mark.asyncio
async def test_session_isolation_and_temporary_context_separation(app_instance, client):
    """Verify temporary conversation history is isolated per session while persistent memory spans sessions."""
    memory_service = app_instance.state.memory_service
    # Session 1: User converses in chat session A
    resp_a = await client.post(
        "/api/chat",
        json={"session_id": "session-a", "message": "My dog's name is Barnaby."},
    )
    assert resp_a.status_code == 200

    # Session 2: User starts new chat session B
    resp_b = await client.post(
        "/api/chat",
        json={"session_id": "session-b", "message": "What did I say earlier?"},
    )
    assert resp_b.status_code == 200

    # Inspect sessions in history service
    history_svc = app_instance.state.history_service
    msgs_a = await history_svc.get_session_messages("session-a")
    msgs_b = await history_svc.get_session_messages("session-b")

    # Conversation context is strictly isolated between sessions
    assert len(msgs_a) >= 2
    assert any("Barnaby" in m.content for m in msgs_a)
    assert not any("Barnaby" in m.content for m in msgs_b)

    # Now store persistent memory
    await memory_service.create_memory(
        category="fact",
        key="pet_name",
        content="User has a dog named Barnaby.",
    )

    # In session C, selective memory retrieval finds this cross-session persistent memory
    relevant = await memory_service.search_relevant_memories("Tell me about my dog Barnaby")
    assert len(relevant) >= 1
    assert relevant[0][0].key == "pet_name"
    assert "Barnaby" in relevant[0][0].content


@pytest.mark.asyncio
async def test_prohibited_secret_and_credential_detection(memory_service):
    """Verify that passwords, API keys, JWT tokens, and private keys are rejected from persistent memory."""
    # Private Key
    with pytest.raises(MemorySecurityError):
        await memory_service.create_memory(
            category="fact",
            content="-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----",
        )

    # API Key pattern
    with pytest.raises(MemorySecurityError):
        await memory_service.create_memory(
            category="fact",
            content="Use this key for testing: sk-abcdef1234567890abcdef1234567890",
        )

    # Password assignment
    with pytest.raises(MemorySecurityError):
        await memory_service.create_memory(
            category="fact",
            content="Remember that my password: superSecretPassword123!",
        )

    # Updating with secret is also rejected
    safe_mem = await memory_service.create_memory(
        category="general",
        content="Safe initial memory content.",
    )
    with pytest.raises(MemorySecurityError):
        await memory_service.update_memory(
            memory_id=safe_mem.id,
            content="api_key: sk-1122334455667788990011223344",
        )


@pytest.mark.asyncio
async def test_selective_relevance_retrieval(memory_service):
    """Verify that only relevant memories are retrieved and the entire database is never dumped into prompts."""
    # Populate multiple diverse memories
    await memory_service.create_memory(
        category="preference",
        key="coding_style",
        content="User prefers TypeScript with strict types and arrow functions.",
    )
    await memory_service.create_memory(
        category="preference",
        key="beverage",
        content="User drinks black coffee with no sugar.",
    )
    await memory_service.create_memory(
        category="project",
        key="aura_repo",
        content="AURA workspace directory is located at C:\\Projects\\AURA.",
    )
    await memory_service.create_memory(
        category="fact",
        key="location",
        content="User resides in Seattle, Washington.",
    )

    # Query specifically about TypeScript coding style
    results = await memory_service.search_relevant_memories(
        query="What coding style should I follow for TypeScript components?",
        limit=2,
    )

    # Only the TypeScript memory should be top ranked
    assert len(results) >= 1
    top_mem, top_score = results[0]
    assert top_mem.key == "coding_style"
    assert "TypeScript" in top_mem.content
    assert top_score > 0.3

    # Check access tracking
    assert top_mem.access_count >= 1
    assert top_mem.last_accessed_at is not None

    # Check prompt formatter
    prompt_block = memory_service.format_relevant_memories_prompt(results)
    assert "RELEVANT USER MEMORIES" in prompt_block
    assert "coding_style" in prompt_block
    assert "coffee" not in prompt_block
    assert "Seattle" not in prompt_block


@pytest.mark.asyncio
async def test_retention_policy_and_expiration(memory_service):
    """Verify retention cleanup deletes expired unpinned memories while keeping pinned items."""
    now = datetime.now(timezone.utc)

    # 1. Pinned memory with expires_at in the past (pinned takes precedence)
    pinned_mem = await memory_service.create_memory(
        category="instruction",
        content="Important permanent rule.",
        is_pinned=True,
    )

    # 2. Expired unpinned memory
    expired_mem = await memory_service.create_memory(
        category="general",
        content="Temporary note from last month.",
        is_pinned=False,
        expires_in_days=1,
    )
    # Manually backdate expiration
    from sqlalchemy import update
    async with memory_service.session_factory() as session:
        await session.execute(
            update(MemoryModel)
            .where(MemoryModel.id == expired_mem.id)
            .values(expires_at=now - timedelta(days=5))
        )
        await session.commit()

    # 3. Future unpinned memory
    future_mem = await memory_service.create_memory(
        category="general",
        content="Valid future note.",
        is_pinned=False,
        expires_in_days=30,
    )

    # Apply retention policy
    purged_count = await memory_service.apply_retention_policy()
    assert purged_count == 1

    # Verify only expired unpinned was deleted
    assert await memory_service.get_memory(pinned_mem.id) is not None
    assert await memory_service.get_memory(future_mem.id) is not None
    assert await memory_service.get_memory(expired_mem.id) is None


@pytest.mark.asyncio
async def test_clear_memories_behavior(memory_service):
    """Verify clearing memories by category or clearing all memories."""
    await memory_service.create_memory(category="preference", content="Pref 1")
    await memory_service.create_memory(category="preference", content="Pref 2")
    await memory_service.create_memory(category="fact", content="Fact 1")

    # Clear only 'preference'
    cleared_prefs = await memory_service.clear_memories(category="preference")
    assert cleared_prefs == 2

    remaining = await memory_service.list_memories()
    assert len(remaining) == 1
    assert remaining[0].category == "fact"

    # Clear all
    cleared_all = await memory_service.clear_memories()
    assert cleared_all == 1

    empty_list = await memory_service.list_memories()
    assert len(empty_list) == 0


@pytest.mark.asyncio
async def test_memory_tools_execution(memory_service):
    """Verify SaveMemoryTool, RecallMemoryTool, and ForgetMemoryTool execution."""
    save_tool = SaveMemoryTool(memory_service=memory_service)
    recall_tool = RecallMemoryTool(memory_service=memory_service)
    forget_tool = ForgetMemoryTool(memory_service=memory_service)

    # 1. SaveMemory under strict without confirmation -> requires confirmation
    ctx_strict_unconfirmed = ExecutionContext(policy="strict", user_confirmed=False)
    save_res1 = await save_tool.execute(
        SaveMemoryArgs(content="User prefers Python 3.12", category="preference", key="python_ver"),
        ctx_strict_unconfirmed,
    )
    assert save_res1.success is False
    assert "requires user confirmation" in save_res1.summary

    # 2. SaveMemory with confirmation
    ctx_confirmed = ExecutionContext(policy="request-review", user_confirmed=True)
    save_res2 = await save_tool.execute(
        SaveMemoryArgs(content="User prefers Python 3.12", category="preference", key="python_ver"),
        ctx_confirmed,
    )
    assert save_res2.success is True
    mem_id = save_res2.data["id"]

    # 3. RecallMemory
    recall_res = await recall_tool.execute(
        RecallMemoryArgs(query="Python version preference"),
        ctx_confirmed,
    )
    assert recall_res.success is True
    assert recall_res.data["count"] == 1
    assert "python_ver" in recall_res.data["results"][0]["key"]

    # 4. ForgetMemory
    forget_res = await forget_tool.execute(
        ForgetMemoryArgs(memory_id=mem_id),
        ctx_confirmed,
    )
    assert forget_res.success is True
    assert forget_res.data["deleted_id"] == mem_id

    # Verify memory is forgotten
    assert await memory_service.get_memory(mem_id) is None


@pytest.mark.asyncio
async def test_memory_api_endpoints(client):
    """Verify REST API endpoints for memory management."""
    # 1. Create memory
    create_resp = await client.post(
        "/api/memory",
        json={
            "category": "preference",
            "key": "theme",
            "content": "User prefers dark mode interfaces with cyan accents.",
            "is_pinned": True,
        },
    )
    assert create_resp.status_code == 201
    created_data = create_resp.json()
    mem_id = created_data["id"]
    assert created_data["key"] == "theme"

    # 2. Get memory
    get_resp = await client.get(f"/api/memory/{mem_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == mem_id

    # 3. Search memories
    search_resp = await client.post(
        "/api/memory/search",
        json={"query": "theme dark mode", "limit": 3},
    )
    assert search_resp.status_code == 200
    hits = search_resp.json()
    assert len(hits) >= 1
    assert hits[0]["memory"]["id"] == mem_id

    # 4. Update memory
    update_resp = await client.put(
        f"/api/memory/{mem_id}",
        json={"content": "User prefers high contrast dark theme."},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["content"] == "User prefers high contrast dark theme."

    # 5. Clear memories
    clear_resp = await client.post(
        "/api/memory/clear",
        json={"confirm": True},
    )
    assert clear_resp.status_code == 200
    assert clear_resp.json()["cleared_count"] >= 1
