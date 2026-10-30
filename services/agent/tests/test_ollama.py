import pytest
import httpx
from aura_agent.services.ollama import (
    OllamaClient,
    OllamaConnectionError,
    OllamaModelNotFoundError,
)


@pytest.mark.asyncio
async def test_is_model_installed_matching():
    client = OllamaClient(base_url="http://127.0.0.1:11434")

    # Mock get_tags response
    async def mock_get_tags():
        return ["qwen3.5:4b", "llama3:latest", "phi4:14b"]

    client.get_tags = mock_get_tags

    # Exact match
    assert await client.is_model_installed("qwen3.5:4b") is True
    # Case insensitivity
    assert await client.is_model_installed("QWEN3.5:4B") is True
    # :latest inference
    assert await client.is_model_installed("llama3") is True
    # Missing model
    assert await client.is_model_installed("gpt-4o") is False


@pytest.mark.asyncio
async def test_ollama_client_unreachable():
    # Point client to a port where nothing is listening
    client = OllamaClient(base_url="http://127.0.0.1:59999", timeout=1.0)

    with pytest.raises(OllamaConnectionError):
        await client.get_tags()


@pytest.mark.asyncio
async def test_chat_raises_when_model_missing():
    client = OllamaClient(base_url="http://127.0.0.1:11434")

    async def mock_tags():
        return ["llama3.2:1b"]

    client.get_tags = mock_tags

    with pytest.raises(OllamaModelNotFoundError):
        await client.chat(
            messages=[{"role": "user", "content": "hi"}],
            model="qwen3.5:4b",
        )
