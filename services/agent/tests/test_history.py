import pytest
from aura_agent.services.history import ConversationHistoryService


@pytest.mark.asyncio
async def test_session_lifecycle_and_messages(in_memory_db):
    service = ConversationHistoryService(in_memory_db)

    # 1. Create a session
    session = await service.get_or_create_session(initial_title="Architecture Session")
    assert session.id is not None
    assert session.title == "Architecture Session"

    # 2. Save user message
    msg1 = await service.save_message(
        session_id=session.id,
        role="user",
        content="What is the local AI stack?",
    )
    assert msg1.id is not None
    assert msg1.role == "user"

    # 3. Save assistant message
    msg2 = await service.save_message(
        session_id=session.id,
        role="assistant",
        content="The stack uses Ollama with qwen3.5:4b and SQLite persistence.",
        model="qwen3.5:4b",
    )
    assert msg2.id is not None
    assert msg2.role == "assistant"

    # 4. Retrieve messages
    messages = await service.get_session_messages(session.id)
    assert len(messages) == 2
    assert messages[0].content == "What is the local AI stack?"
    assert messages[1].content == "The stack uses Ollama with qwen3.5:4b and SQLite persistence."

    # 5. Build conversation context for follow-up question
    context = await service.build_conversation_context(
        session_id=session.id,
        new_user_message="Does it require external API keys?",
    )
    assert len(context) == 3
    assert context[0]["role"] == "user"
    assert context[1]["role"] == "assistant"
    assert context[2]["role"] == "user"
    assert context[2]["content"] == "Does it require external API keys?"

    # 6. List sessions
    sessions_list = await service.get_all_sessions()
    assert len(sessions_list) == 1
    assert sessions_list[0].id == session.id
    assert sessions_list[0].message_count == 2

    # 7. Delete session
    deleted = await service.delete_session(session.id)
    assert deleted is True

    # Confirm session and messages removed
    messages_after = await service.get_session_messages(session.id)
    assert len(messages_after) == 0
