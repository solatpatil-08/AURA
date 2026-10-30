import json
import pytest
import httpx
from tests.conftest import MockOllamaClient


@pytest.mark.asyncio
async def test_chat_non_streaming(client: httpx.AsyncClient):
    payload = {
        "message": "Hello AURA, please explain the local architecture.",
        "stream": False,
    }
    response = await client.post("/api/chat", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["role"] == "assistant"
    assert "Mocked response to: Hello AURA" in data["content"]
    assert data["model"] == "qwen3.5:4b"
    assert "session_id" in data
    assert "message_id" in data


@pytest.mark.asyncio
async def test_chat_streaming(client: httpx.AsyncClient):
    payload = {
        "message": "Generate a quick summary",
        "stream": True,
    }
    response = await client.post("/api/chat", json=payload)
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]

    deltas = []
    done_received = False
    for line in response.text.split("\n"):
        if line.startswith("data: "):
            chunk = json.loads(line[6:])
            if chunk.get("delta"):
                deltas.append(chunk["delta"])
            if chunk.get("done"):
                done_received = True

    assert len(deltas) > 0
    assert "".join(deltas) == "This is a streamed mock response."
    assert done_received is True


@pytest.mark.asyncio
async def test_chat_missing_model_error(app_instance, client: httpx.AsyncClient):
    # Simulate requested model not being installed
    app_instance.state.ollama_client = MockOllamaClient(models=["other-model:latest"], fail_mode="missing_model")

    payload = {
        "message": "How does this work?",
        "model_override": "non-existent-model",
        "stream": False,
    }
    response = await client.post("/api/chat", json=payload)
    assert response.status_code == 404
    assert "not installed in local Ollama" in response.json()["detail"]


@pytest.mark.asyncio
async def test_chat_ollama_offline_error(app_instance, client: httpx.AsyncClient):
    # Simulate Ollama offline
    app_instance.state.ollama_client = MockOllamaClient(fail_mode="offline")

    payload = {
        "message": "Testing offline behavior",
        "stream": False,
    }
    response = await client.post("/api/chat", json=payload)
    assert response.status_code == 503
    assert "Ollama" in response.json()["detail"]


@pytest.mark.asyncio
async def test_chat_invalid_request_validation(client: httpx.AsyncClient):
    # Empty message should trigger Pydantic validation error (422)
    payload = {
        "message": "",
        "stream": False,
    }
    response = await client.post("/api/chat", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_chat_payload_too_large(client: httpx.AsyncClient):
    # Massive payload exceeding 2MB limit
    headers = {"content-length": str(3 * 1024 * 1024)}
    response = await client.post("/api/chat", content=b"a" * 100, headers=headers)
    assert response.status_code == 413
