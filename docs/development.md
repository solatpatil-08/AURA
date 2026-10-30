# AURA Developer and Contributor Guide

This guide establishes the engineering conventions, architecture standards, testing practices, and security invariants required when developing or extending AURA.

---

## 1. Codebase Structure

```
AURA/
├── apps/
│   └── desktop/                  # Electron + React + TypeScript Desktop Client
│       ├── electron.vite.config.ts # Bundler & build configuration
│       ├── electron-builder.yml  # Windows installer packaging spec
│       ├── src/
│       │   ├── main/             # Electron main process (security, IPC, supervisor)
│       │   ├── preload/          # Context bridge (secure isolated API exposure)
│       │   └── renderer/         # React UI (components, hooks, Three.js VRM stage)
│       └── test/                 # Vitest component & interaction tests
├── docs/                         # Architecture, Security, and API specifications
├── services/
│   └── agent/                    # Python FastAPI AI & Tool Execution Engine
│       ├── aura_agent/
│       │   ├── api/              # HTTP routers (chat, voice, tools, memory, tasks)
│       │   ├── models/           # Pydantic request/response & database schemas
│       │   ├── services/         # Ollama, STT, TTS, memory, browser, orchestrator
│       │   └── tools/            # Tool registry, PathJail sandbox, and security
│       └── tests/                # Pytest async test suite (88 passing unit tests)
└── package.json                  # Workspace root
```

---

## 2. Security Invariants (Do Not Violate)

1. **Zero Remote AI Calls**:
   - Never introduce code that connects to OpenAI, Anthropic, Google Cloud, or other third-party cloud LLM APIs. All intelligence must run through local Ollama (`http://127.0.0.1:11434`).
2. **Localhost and Origin Containment**:
   - The FastAPI backend must listen exclusively on `127.0.0.1`.
   - The `security_guard_middleware` in `aura_agent/main.py` enforces both `Host` and `Origin` validation, rejecting cross-site localhost hijacking attempts with HTTP 403 Forbidden.
3. **Electron Context Isolation**:
   - `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` are mandatory on all BrowserWindows.
   - Never expose Node's `child_process`, `fs`, or raw IPC senders to the renderer. All IPC must be statically declared in `preload/index.ts` with strict input validation in `main/ipc.ts`.
4. **Filesystem PathJail**:
   - All filesystem operations must pass through `PathJail.validate_path(path, workspace_root)`. Symlinks, traversal patterns (`..`), and absolute system drive escapes are strictly prohibited.
5. **No Blind Command Execution**:
   - Language models must never be given unrestricted shell access. Process execution is limited to the configured `allowed_applications` dictionary with strict validation.

---

## 3. Tool Development Workflow

To add a new tool to AURA:
1. Define the tool function in `services/agent/aura_agent/tools/builtin.py`.
2. Wrap the tool with the `@tool_registry.register` decorator:
   ```python
   @tool_registry.register(
       name="my_new_tool",
       description="Clear description of the tool purpose",
       risk_tier=RiskTier.LOW,  # or RiskTier.HIGH if it produces irreversible external side effects
       requires_confirmation=False,
   )
   async def my_new_tool(workspace_root: str, param: str) -> Dict[str, Any]:
       # Implementation using PathJail if interacting with files
       ...
   ```
3. Add a dedicated test in `services/agent/tests/test_tools.py` verifying both valid input and boundary rejection.

---

## 4. Testing & Verification

### Running Backend Tests
```powershell
cd C:\Projects\AURA\services\agent
.\.venv\Scripts\pytest -v
```

### Running Frontend Tests & Type Checking
```powershell
cd C:\Projects\AURA\apps\desktop
npm run lint          # ESLint (must have 0 errors and 0 warnings)
npm run typecheck     # TypeScript compiler check (both node and web targets)
npm run test          # Vitest component test suite
```

### Building & Packaging
```powershell
cd C:\Projects\AURA\apps\desktop
npm run build         # Production Vite bundling
npm run package       # Unpacked Windows binary (dist/win-unpacked)
npm run dist          # Full NSIS Windows setup installer
```
