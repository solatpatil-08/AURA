import pytest
import httpx
from tests.conftest import MockOllamaClient


@pytest.mark.asyncio
async def test_system_status_healthy(client: httpx.AsyncClient):
    response = await client.get("/api/system/status")
    assert response.status_code == 200
    data = response.json()

    assert data["backend_status"] == "ready"
    assert data["ollama"]["connected"] is True
    assert "qwen3.5:4b" in data["ollama"]["available_models"]
    assert data["ollama"]["model_installed"] is True
    assert data["ollama"]["error_message"] is None


@pytest.mark.asyncio
async def test_system_status_missing_model(app_instance, client: httpx.AsyncClient):
    # Set mock client without the configured model
    app_instance.state.ollama_client = MockOllamaClient(models=["llama3.2:1b"], fail_mode="missing_model")

    response = await client.get("/api/system/status")
    assert response.status_code == 200
    data = response.json()

    assert data["ollama"]["connected"] is True
    assert data["ollama"]["model_installed"] is False
    assert "not installed in local Ollama" in data["ollama"]["error_message"]


@pytest.mark.asyncio
async def test_system_status_ollama_offline(app_instance, client: httpx.AsyncClient):
    # Set mock client to offline failure mode
    app_instance.state.ollama_client = MockOllamaClient(fail_mode="offline")

    response = await client.get("/api/system/status")
    assert response.status_code == 200
    data = response.json()

    assert data["ollama"]["connected"] is False
    assert data["ollama"]["error_message"] is not None
    assert "Cannot connect to Ollama" in data["ollama"]["error_message"]


@pytest.mark.asyncio
async def test_security_allowed_origin(client: httpx.AsyncClient):
    response = await client.get("/api/system/status", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_security_rejects_untrusted_origin(client: httpx.AsyncClient):
    response = await client.get("/api/system/status", headers={"Origin": "https://malicious-site.com"})
    assert response.status_code == 403
    assert "Untrusted origin" in response.json()["detail"]


@pytest.mark.asyncio
async def test_security_rejects_external_host(client: httpx.AsyncClient):
    response = await client.get("/api/system/status", headers={"Host": "evil-domain.com"})
    assert response.status_code == 403
    assert "strictly bound to localhost" in response.json()["detail"]
