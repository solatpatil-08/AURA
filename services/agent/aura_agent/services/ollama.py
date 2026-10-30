import json
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional
import httpx

logger = logging.getLogger("aura.ollama")


class OllamaError(Exception):
    """Base exception for Ollama interactions."""
    pass


class OllamaConnectionError(OllamaError):
    """Raised when Ollama service is unreachable on localhost."""
    pass


class OllamaModelNotFoundError(OllamaError):
    """Raised when the requested model is not present in local Ollama."""
    pass


class OllamaTimeoutError(OllamaError):
    """Raised when an Ollama inference request exceeds the configured timeout."""
    pass


class OllamaClient:
    """Async client communicating with local Ollama daemon."""

    def __init__(self, base_url: str = "http://127.0.0.1:11434", timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def get_tags(self) -> List[str]:
        """Fetch list of locally installed model names from Ollama."""
        url = f"{self.base_url}/api/tags"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                if response.status_code != 200:
                    raise OllamaConnectionError(f"Ollama returned HTTP {response.status_code}")
                data = response.json()
                models = [m.get("name", "") for m in data.get("models", [])]
                return models
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise OllamaConnectionError(
                f"Cannot connect to Ollama at {self.base_url}. Ensure Ollama is installed and running."
            ) from exc
        except httpx.TimeoutException as exc:
            raise OllamaTimeoutError(f"Request to Ollama timed out after {self.timeout}s") from exc
        except Exception as exc:
            if isinstance(exc, OllamaError):
                raise
            raise OllamaConnectionError(f"Unexpected error communicating with Ollama: {exc}") from exc

    async def is_model_installed(self, model_name: str) -> bool:
        """Check whether a specific model (or model:latest) exists in local Ollama."""
        tags = await self.get_tags()
        # Check exact match or :latest tag
        target = model_name.lower()
        for tag in tags:
            tag_lower = tag.lower()
            if tag_lower == target:
                return True
            if tag_lower == f"{target}:latest" or f"{tag_lower}:latest" == target:
                return True
        return False

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        model: str,
        system_prompt: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Execute a non-streaming chat request with the local Ollama model, supporting function/tool calls."""
        url = f"{self.base_url}/api/chat"

        # Verify model presence first to avoid confusing Ollama auto-pull errors
        installed = await self.is_model_installed(model)
        if not installed:
            raise OllamaModelNotFoundError(
                f"Model '{model}' is not installed in local Ollama. Please run 'ollama run {model}' to download it first."
            )

        payload_messages = []
        if system_prompt:
            payload_messages.append({"role": "system", "content": system_prompt})
        payload_messages.extend(messages)

        payload: Dict[str, Any] = {
            "model": model,
            "messages": payload_messages,
            "stream": False,
            "options": {
                "temperature": 0.7,
            },
        }
        if tools:
            payload["tools"] = tools

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload)
                if response.status_code == 404:
                    raise OllamaModelNotFoundError(
                        f"Model '{model}' not found in Ollama. Run: 'ollama run {model}'"
                    )
                if response.status_code != 200:
                    raise OllamaError(f"Ollama returned HTTP {response.status_code}: {response.text}")

                data = response.json()
                message_dict = data.get("message", {})
                message_content = message_dict.get("content", "")
                tool_calls = message_dict.get("tool_calls", [])
                return {
                    "content": message_content,
                    "tool_calls": tool_calls,
                    "model": data.get("model", model),
                    "total_duration_ms": data.get("total_duration", 0) / 1_000_000.0,
                    "eval_count": data.get("eval_count", 0),
                }
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise OllamaConnectionError(f"Failed to connect to local Ollama at {self.base_url}") from exc
        except httpx.TimeoutException as exc:
            raise OllamaTimeoutError(f"Inference with model '{model}' timed out after {self.timeout}s") from exc

    async def chat_stream(
        self,
        messages: List[Dict[str, str]],
        model: str,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream token deltas from local Ollama via chunked NDJSON."""
        url = f"{self.base_url}/api/chat"

        installed = await self.is_model_installed(model)
        if not installed:
            raise OllamaModelNotFoundError(
                f"Model '{model}' is not installed in local Ollama. Please run 'ollama run {model}' to download it first."
            )

        payload_messages = []
        if system_prompt:
            payload_messages.append({"role": "system", "content": system_prompt})
        payload_messages.extend(messages)

        payload = {
            "model": model,
            "messages": payload_messages,
            "stream": True,
            "options": {
                "temperature": 0.7,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", url, json=payload) as response:
                    if response.status_code != 200:
                        content = await response.aread()
                        raise OllamaError(f"Ollama streaming returned HTTP {response.status_code}: {content.decode('utf-8')}")

                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                            delta = chunk.get("message", {}).get("content", "")
                            if delta:
                                yield delta
                            if chunk.get("done", False):
                                break
                        except json.JSONDecodeError:
                            continue
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            raise OllamaConnectionError(f"Failed to connect to local Ollama at {self.base_url}") from exc
        except httpx.TimeoutException as exc:
            raise OllamaTimeoutError(f"Inference with model '{model}' timed out after {self.timeout}s") from exc
