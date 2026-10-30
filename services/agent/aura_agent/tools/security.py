import os
import pathlib
import re
from typing import Dict, List, Optional, Tuple, Union
from urllib.parse import urlparse


class SecurityViolationError(PermissionError):
    """Raised when an operation violates AURA security or path containment policies."""
    pass


class PathJail:
    """Canonical path validator preventing directory traversal, sensitive file access, and workspace escape."""

    PROHIBITED_FILENAMES = {
        ".env",
        ".env.local",
        ".env.production",
        "id_rsa",
        "id_rsa.pub",
        "id_ed25519",
        "id_ed25519.pub",
        "credentials",
        "credentials.json",
        "secrets.json",
        ".npmrc",
        ".pypirc",
        "login data",
        "cookies",
        "web data",
        "places.sqlite",
        "key4.db",
        "logins.json",
    }

    def __init__(
        self,
        allowed_workspaces: List[Union[str, pathlib.Path]],
        notes_dir: Optional[Union[str, pathlib.Path]] = None,
        max_file_bytes: int = 5 * 1024 * 1024,
    ):
        self.allowed_workspaces = [pathlib.Path(w).resolve() for w in allowed_workspaces if w]
        self.notes_dir = pathlib.Path(notes_dir).resolve() if notes_dir else None
        if self.notes_dir and self.notes_dir not in self.allowed_workspaces:
            self.allowed_workspaces.append(self.notes_dir)

        self.max_file_bytes = max_file_bytes

        # Prohibited system and sensitive user roots
        user_home = pathlib.Path.home().resolve()
        self.prohibited_prefixes = [
            pathlib.Path("C:/Windows").resolve(),
            pathlib.Path("C:/Program Files").resolve(),
            pathlib.Path("C:/Program Files (x86)").resolve(),
            user_home / ".ssh",
            user_home / ".aws",
            user_home / ".azure",
            user_home / ".gcp",
            user_home / ".gnupg",
            user_home / "AppData" / "Local" / "Google" / "Chrome",
            user_home / "AppData" / "Local" / "Microsoft" / "Edge",
            user_home / "AppData" / "Roaming" / "Mozilla" / "Firefox",
        ]

    def validate_path(
        self,
        target_path: Union[str, pathlib.Path],
        must_exist: bool = False,
        allow_outside_workspace: bool = False,
    ) -> pathlib.Path:
        """Resolve and strictly canonicalize path, checking jail containment and prohibited blocklists."""
        if not target_path:
            raise SecurityViolationError("Path cannot be empty.")

        # Convert to pathlib.Path and canonicalize
        target = pathlib.Path(target_path)
        if not target.is_absolute():
            # If relative, resolve against the primary workspace root
            primary_root = self.allowed_workspaces[0] if self.allowed_workspaces else pathlib.Path.cwd().resolve()
            resolved = (primary_root / target).resolve()
        else:
            resolved = target.resolve()

        # Check explicit prohibited prefixes
        resolved_str = str(resolved).lower().rstrip("\\/")
        for prohibited in self.prohibited_prefixes:
            try:
                prohibited_str = str(prohibited).lower().rstrip("\\/")
                if (
                    resolved_str == prohibited_str
                    or resolved_str.startswith(prohibited_str + "\\")
                    or resolved == prohibited
                    or prohibited in resolved.parents
                ):
                    raise SecurityViolationError(f"Access to protected system directory is prohibited: {resolved}")
            except SecurityViolationError:
                raise
            except Exception:
                continue

        # Check prohibited sensitive filenames / credential stores
        if resolved.name.lower() in self.PROHIBITED_FILENAMES:
            raise SecurityViolationError(f"Access to credential or secret file '{resolved.name}' is strictly blocked.")

        # Check workspace containment
        if not allow_outside_workspace:
            in_workspace = False
            for workspace in self.allowed_workspaces:
                ws_str = str(workspace).lower().rstrip("\\/")
                if (
                    resolved_str == ws_str
                    or resolved_str.startswith(ws_str + "\\")
                    or resolved == workspace
                    or workspace in resolved.parents
                ):
                    in_workspace = True
                    break

            if not in_workspace:
                raise SecurityViolationError(
                    f"Path traversal rejected: '{resolved}' escapes allowed workspace roots."
                )

        if must_exist and not resolved.exists():
            raise FileNotFoundError(f"Target path does not exist: {resolved}")

        return resolved

    def validate_file_for_read(self, target_path: Union[str, pathlib.Path]) -> pathlib.Path:
        """Validate that target path exists, is inside workspace, within size limits, and is readable text."""
        resolved = self.validate_path(target_path, must_exist=True)

        if resolved.is_dir():
            raise IsADirectoryError(f"Cannot read directory as file: {resolved}")

        # Size check
        size = resolved.stat().st_size
        if size > self.max_file_bytes:
            raise SecurityViolationError(
                f"File size ({size} bytes) exceeds maximum allowable limit of {self.max_file_bytes} bytes (5 MB)."
            )

        # Basic binary detection (check first 1024 bytes for null bytes)
        try:
            with open(resolved, "rb") as f:
                chunk = f.read(1024)
                if b"\x00" in chunk:
                    raise SecurityViolationError(f"Binary file reading is prohibited: {resolved.name}")
        except OSError as exc:
            raise SecurityViolationError(f"Unable to read file: {exc}") from exc

        return resolved


class ApplicationAllowlist:
    """Guardrails for external process execution ensuring strictly allowlisted binaries and no shell interpretation."""

    PROHIBITED_COMMANDS = {
        "cmd", "cmd.exe",
        "powershell", "powershell.exe",
        "pwsh", "pwsh.exe",
        "bash", "bash.exe",
        "sh", "sh.exe",
        "zsh", "zsh.exe",
        "wscript", "wscript.exe",
        "cscript", "cscript.exe",
        "reg", "reg.exe",
        "rundll32", "rundll32.exe",
        "mshta", "mshta.exe",
        "certutil", "certutil.exe",
    }

    DANGEROUS_ARG_CHARS = set("&|;><`$\n\r")

    def __init__(self, allowed_apps: Optional[Dict[str, str]] = None):
        self.allowed_apps: Dict[str, str] = {
            "notepad": "C:\\Windows\\System32\\notepad.exe",
            "calc": "C:\\Windows\\System32\\calc.exe",
            "explorer": "C:\\Windows\\explorer.exe",
            "code": "code",
        }
        if allowed_apps:
            self.allowed_apps.update(allowed_apps)

    def validate_app_execution(
        self,
        app_name: str,
        args: Optional[List[str]] = None,
    ) -> Tuple[str, List[str]]:
        """Validate requested application identifier and arguments."""
        clean_app = app_name.strip().lower()

        # Reject prohibited shell interpreters
        if clean_app in self.PROHIBITED_COMMANDS:
            raise SecurityViolationError(f"Execution of shell command '{clean_app}' is strictly prohibited.")

        # Check allowlist
        if clean_app not in self.allowed_apps:
            valid_keys = ", ".join(sorted(self.allowed_apps.keys()))
            raise SecurityViolationError(
                f"Application '{app_name}' is not in the allowlist. Allowed applications: [{valid_keys}]"
            )

        executable = self.allowed_apps[clean_app]

        # Sanitize arguments
        clean_args: List[str] = []
        if args:
            for arg in args:
                if any(ch in arg for ch in self.DANGEROUS_ARG_CHARS):
                    raise SecurityViolationError(
                        f"Argument contains illegal shell metacharacters: {arg}"
                    )
                clean_args.append(arg)

        return executable, clean_args


class URLValidator:
    """Validates destination web addresses for safe browser opening."""

    ALLOWED_SCHEMES = {"http", "https"}

    @classmethod
    def validate_url(cls, url: str) -> str:
        """Validate that the URL uses permitted schemes and has a valid host."""
        if not url or not url.strip():
            raise SecurityViolationError("URL cannot be empty.")

        url = url.strip()
        parsed = urlparse(url)

        if parsed.scheme.lower() not in cls.ALLOWED_SCHEMES:
            raise SecurityViolationError(
                f"URL scheme '{parsed.scheme}' is prohibited. Only HTTP and HTTPS URLs are permitted."
            )

        if not parsed.netloc:
            raise SecurityViolationError("URL is missing a valid domain or host name.")

        if parsed.username or parsed.password:
            raise SecurityViolationError("URLs with embedded authentication credentials are not permitted.")

        return url
