"""Keep the loopback UI available without owning or configuring instruments.

Windows Task Scheduler owns this process, independently of a terminal/browser.
An existing MOT server is reused; an occupied foreign port is never terminated.
"""
from __future__ import annotations

import argparse
import ctypes
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
APP = "mot556-console"
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def probe(port):
    """Health is independent of slow instrument reads; accept legacy MOT servers."""
    try:
        try:
            response = HTTP.open(f"http://127.0.0.1:{port}/api/health", timeout=2)
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                return "busy", {}
            response = exc  # v1.2.0 identifies itself even on a missing endpoint.
        with response:
            payload = json.loads(response.read(16384))
        if isinstance(payload, dict) and payload.get("app") == APP:
            return "running", payload
        return "foreign", {}
    except (OSError, ValueError, TypeError):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.3):
                return "busy", {}
        except OSError:
            return "stopped", {}


class SingleInstance:
    def __init__(self, port):
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
        self.kernel.CreateMutexW.restype = ctypes.c_void_p
        self.kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        self.handle = self.kernel.CreateMutexW(None, False, f"Local\\MOT-PID-Console-{port}")
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        self.duplicate = ctypes.get_last_error() == 183

    def close(self):
        self.kernel.CloseHandle(self.handle)


def watch(port, runtime):
    guard = SingleInstance(port)
    if guard.duplicate:
        guard.close()
        return 0
    runtime.mkdir(parents=True, exist_ok=True)
    log = logging.getLogger("mot-launcher")
    log.setLevel(logging.INFO)
    handler = RotatingFileHandler(runtime / "launcher.log", maxBytes=1_000_000, backupCount=2, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    log.info("Watcher started: pid=%s port=%s source=%s", os.getpid(), port, ROOT)
    child = None
    previous = None
    retry_at = 0
    try:
        while True:
            state, info = probe(port)
            if child is not None and child.poll() is not None:
                log.warning("Server exited: pid=%s code=%s", child.pid, child.returncode)
                child = None
                retry_at = time.monotonic() + 2
            if state != previous:
                log.info("Server state: %s version=%s pid=%s", state, info.get("version"), info.get("pid"))
                previous = state
            if state == "stopped" and child is None and time.monotonic() >= retry_at:
                server_log = runtime / "server.log"
                if server_log.exists() and server_log.stat().st_size > 5_000_000:
                    server_log.replace(runtime / "server.previous.log")
                try:
                    with server_log.open("ab", buffering=0) as output:
                        child = subprocess.Popen(
                            [sys.executable, "-B", "-u", str(ROOT / "server.py"), "--port", str(port)],
                            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                            creationflags=subprocess.CREATE_NO_WINDOW,
                            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"},
                        )
                    log.info("Started server: pid=%s (no instruments opened)", child.pid)
                except OSError:
                    log.exception("Could not start server")
                    retry_at = time.monotonic() + 10
            time.sleep(2)
    except KeyboardInterrupt:
        return 0
    finally:
        guard.close()
        handler.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    if os.name != "nt":
        parser.error("Use python server.py on non-Windows systems")
    if not 1024 <= args.port <= 65535:
        parser.error("port must be 1024..65535")
    runtime = Path(os.environ["LOCALAPPDATA"]) / "MOT-PID-Control-Console" / str(args.port)
    return watch(args.port, runtime)


if __name__ == "__main__":
    raise SystemExit(main())
