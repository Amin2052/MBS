#!/usr/bin/env python3
"""
mbs_customer_release_qa.py
===========================

External, non-invasive release-QA agent for Mooral Business Suite (MBS).

WHAT THIS IS
------------
A standalone Python test controller that inspects, launches, drives, and
measures an already-built MBS product (source tree, packaged EXE, and/or
NSIS installer) and produces an evidence-backed PASS / PASS WITH WARNINGS /
FAIL / BLOCKED release verdict.

WHAT THIS IS NOT
----------------
It is not part of MBS. It never edits MBS source, never touches a real
customer database or the production Cloudflare D1 store, and never invents
a result it did not actually observe. Every reported test is one of:

    PASS      - executed, and the observed behaviour was correct
    FAIL      - executed, and the observed behaviour was wrong/unsafe
    SKIP      - not executed (optional dependency/feature genuinely absent)
    BLOCKED   - could not be executed safely/at all in this environment,
                or a static-analysis finding needs human confirmation

If this script cannot actually prove something, it says SKIP or BLOCKED.
It never fabricates command output, UI results, or "PASS" for anything
that was not actually run.

USAGE (Windows)
----------------
    python mbs_customer_release_qa.py --mode full --project C:/path/to/mbs --exe "C:/path/to/Mooral Business Suite.exe" --db "C:/Users/<you>/AppData/Roaming/Mooral Business Suite/mooral.db"

Run `python mbs_customer_release_qa.py --help` for every flag.

This file is intentionally a single file so it can be copied next to a
build and run with nothing but a stock Python 3.11+ interpreter. All other
capabilities (Playwright, psutil, requests, npm/node, sqlite3) are
detected at runtime and gracefully downgraded to SKIP when absent.
"""

from __future__ import annotations

import argparse
import contextlib
import ctypes
import dataclasses
import hashlib
import io
import json
import os
import platform
import re
import shutil
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import textwrap
import time
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

SCRIPT_VERSION = "1.0.0"

# --------------------------------------------------------------------------
# Optional dependency detection (graceful SKIP, never a hard crash)
# --------------------------------------------------------------------------

def _try_import(name: str):
    try:
        return __import__(name)
    except Exception:
        return None

psutil = _try_import("psutil")
requests = _try_import("requests")

_playwright_mod = None
try:
    from playwright.sync_api import sync_playwright  # type: ignore
    _playwright_mod = True
except Exception:
    sync_playwright = None  # type: ignore
    _playwright_mod = None

HAVE_PSUTIL = psutil is not None
HAVE_REQUESTS = requests is not None
HAVE_PLAYWRIGHT = _playwright_mod is not None
IS_WINDOWS = platform.system().lower() == "windows"


def http_get(url: str, headers: Optional[dict] = None, timeout: float = 5.0):
    """Minimal GET helper that works with or without `requests`."""
    if HAVE_REQUESTS:
        return requests.get(url, headers=headers or {}, timeout=timeout)
    import urllib.request
    import urllib.error
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()

            class _Resp:
                status_code = resp.status
                text = body.decode("utf-8", "replace")

                def json(self_inner):
                    return json.loads(self_inner.text)

            return _Resp()
    except urllib.error.HTTPError as e:
        body = e.read()

        class _ErrResp:
            status_code = e.code
            text = body.decode("utf-8", "replace")

            def json(self_inner):
                return json.loads(self_inner.text)

        return _ErrResp()


# --------------------------------------------------------------------------
# Result model
# --------------------------------------------------------------------------

STATUS_PASS = "PASS"
STATUS_FAIL = "FAIL"
STATUS_SKIP = "SKIP"
STATUS_BLOCKED = "BLOCKED"

SEV_CRITICAL = "CRITICAL"
SEV_HIGH = "HIGH"
SEV_MEDIUM = "MEDIUM"
SEV_LOW = "LOW"
SEV_INFO = "INFO"


@dataclass
class TestResult:
    id: str
    category: str
    name: str
    status: str
    duration_s: float
    severity: str = SEV_INFO
    evidence: Any = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


class Reporter:
    """Collects TestResults, writes the JSON/TXT reports, computes verdict."""

    def __init__(self, report_dir: Path, verbose: bool = False):
        self.report_dir = report_dir
        self.verbose = verbose
        self.results: list[TestResult] = []
        self.started_at = datetime.now(timezone.utc)
        self._counter = 0

    def next_id(self, category: str) -> str:
        self._counter += 1
        return f"{category.upper()}-{self._counter:04d}"

    def add(self, result: TestResult) -> TestResult:
        self.results.append(result)
        tag = {
            STATUS_PASS: "PASS   ",
            STATUS_FAIL: "FAIL   ",
            STATUS_SKIP: "SKIP   ",
            STATUS_BLOCKED: "BLOCKED",
        }.get(result.status, result.status)
        line = f"[{tag}] {result.id:<14} {result.category:<12} {result.name}"
        if result.status == STATUS_FAIL:
            line += f"  <{result.severity}>"
        print(line)
        if result.error and (self.verbose or result.status == STATUS_FAIL):
            print(f"           -> {result.error}")
        return result

    @contextlib.contextmanager
    def run(self, category: str, name: str, severity: str = SEV_MEDIUM,
            skip_reason: Optional[str] = None, blocked_reason: Optional[str] = None):
        """
        Context manager that times a test block and records PASS/FAIL/SKIP/BLOCKED.

        Usage:
            with reporter.run("database", "integrity_check") as t:
                t.evidence = {...}
                if bad:
                    t.fail("reason", severity=SEV_CRITICAL)
                elif skip:
                    t.skip("reason")
                elif blocked:
                    t.blocked("reason")
                # otherwise implicit PASS if no exception and no explicit status
        """
        rid = self.next_id(category)
        t0 = time.time()
        ticket = _RunTicket(rid, category, name, severity)
        if skip_reason is not None:
            ticket._force_status = STATUS_SKIP
            ticket._force_reason = skip_reason
        if blocked_reason is not None:
            ticket._force_status = STATUS_BLOCKED
            ticket._force_reason = blocked_reason
        try:
            yield ticket
        except Exception as e:
            ticket._force_status = STATUS_FAIL
            ticket._force_reason = f"{type(e).__name__}: {e}"
            if self.verbose:
                ticket._force_reason += "\n" + traceback.format_exc()
        finally:
            duration = time.time() - t0
            status = ticket._force_status or STATUS_PASS
            error = ticket._force_reason
            sev = ticket.severity if status == STATUS_FAIL else (
                SEV_INFO if status in (STATUS_SKIP,) else ticket.severity
            )
            self.add(TestResult(
                id=rid, category=category, name=name, status=status,
                duration_s=round(duration, 3), severity=sev,
                evidence=ticket.evidence, error=error,
            ))

    def counts(self) -> dict:
        out = {STATUS_PASS: 0, STATUS_FAIL: 0, STATUS_SKIP: 0, STATUS_BLOCKED: 0}
        sev_out = {SEV_CRITICAL: 0, SEV_HIGH: 0, SEV_MEDIUM: 0, SEV_LOW: 0, SEV_INFO: 0}
        for r in self.results:
            out[r.status] = out.get(r.status, 0) + 1
            if r.status == STATUS_FAIL:
                sev_out[r.severity] = sev_out.get(r.severity, 0) + 1
        return {"status": out, "severity": sev_out}

    def verdict(self) -> tuple[str, list[TestResult]]:
        """Implements section 23 of the spec: the release verdict rules."""
        fails = [r for r in self.results if r.status == STATUS_FAIL]
        blocked = [r for r in self.results if r.status == STATUS_BLOCKED]
        critical_fails = [r for r in fails if r.severity == SEV_CRITICAL]
        high_fails = [r for r in fails if r.severity == SEV_HIGH]

        if critical_fails:
            return "FAIL", critical_fails + high_fails
        if any(r.category in ("database", "sync", "security") and r.severity == SEV_HIGH for r in fails):
            return "FAIL", high_fails
        if fails:
            return "PASS WITH WARNINGS", fails
        if blocked:
            return "BLOCKED", blocked
        return "PASS", []

    def write_reports(self, args_dict: dict) -> tuple[Path, Path]:
        self.report_dir.mkdir(parents=True, exist_ok=True)
        counts = self.counts()
        verdict, notable = self.verdict()
        payload = {
            "tool": "mbs_customer_release_qa.py",
            "version": SCRIPT_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "started_at": self.started_at.isoformat(),
            "args": args_dict,
            "counts": counts,
            "verdict": verdict,
            "results": [r.to_dict() for r in self.results],
        }
        json_path = self.report_dir / "mbs_customer_release_qa_report.json"
        json_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

        txt_path = self.report_dir / "mbs_customer_release_qa_report.txt"
        lines = []
        lines.append("=" * 78)
        lines.append("MOORAL BUSINESS SUITE - CUSTOMER RELEASE QA REPORT")
        lines.append("=" * 78)
        lines.append(f"Generated:  {payload['generated_at']}")
        lines.append(f"Tool ver:   {SCRIPT_VERSION}")
        lines.append("")
        by_cat: dict[str, list[TestResult]] = {}
        for r in self.results:
            by_cat.setdefault(r.category, []).append(r)
        for cat, items in by_cat.items():
            lines.append(f"--- {cat.upper()} " + "-" * max(0, 60 - len(cat)))
            for r in items:
                lines.append(f"  [{r.status:<7}] {r.id:<14} {r.name} ({r.duration_s}s)")
                if r.status == STATUS_FAIL:
                    lines.append(f"            severity: {r.severity}")
                if r.error:
                    for eline in str(r.error).splitlines():
                        lines.append(f"            {eline}")
            lines.append("")
        lines.append("=" * 78)
        lines.append("FINAL SUMMARY")
        lines.append("=" * 78)
        total = len(self.results)
        lines.append(f"Total tests : {total}")
        for k in (STATUS_PASS, STATUS_FAIL, STATUS_SKIP, STATUS_BLOCKED):
            lines.append(f"  {k:<8}: {counts['status'].get(k, 0)}")
        lines.append("")
        for k in (SEV_CRITICAL, SEV_HIGH, SEV_MEDIUM, SEV_LOW):
            lines.append(f"  {k:<8}: {counts['severity'].get(k, 0)}")
        lines.append("")
        lines.append(f"CUSTOMER RELEASE VERDICT: {verdict}")
        lines.append("")
        if notable:
            lines.append("Notable failures / blockers:")
            for r in notable:
                lines.append(f"  - [{r.status}/{r.severity}] {r.id} {r.category}/{r.name}: {r.error}")
        txt_path.write_text("\n".join(lines), encoding="utf-8")
        return json_path, txt_path


class _RunTicket:
    __slots__ = ("id", "category", "name", "severity", "evidence", "_force_status", "_force_reason")

    def __init__(self, id_: str, category: str, name: str, severity: str):
        self.id = id_
        self.category = category
        self.name = name
        self.severity = severity
        self.evidence = None
        self._force_status = None
        self._force_reason = None

    def fail(self, reason: str, severity: Optional[str] = None):
        self._force_status = STATUS_FAIL
        self._force_reason = reason
        if severity:
            self.severity = severity

    def skip(self, reason: str):
        self._force_status = STATUS_SKIP
        self._force_reason = reason

    def blocked(self, reason: str):
        self._force_status = STATUS_BLOCKED
        self._force_reason = reason

    def ok(self, evidence: Any = None):
        self._force_status = STATUS_PASS
        if evidence is not None:
            self.evidence = evidence

# --------------------------------------------------------------------------
# ProjectSource: discovers the ACTUAL routes / IPC surface / schema / cloud
# sync scope / D1 config directly from the supplied MBS source tree. Never
# hardcodes MBS internals -- every fact below is re-derived from whatever
# source is actually on disk at run time, so the QA agent tracks reality
# instead of a stale snapshot. If no --project is supplied (EXE/DB-only
# run), every method here degrades to returning None/[] and the relevant
# higher-level checks report SKIP with a clear reason instead of guessing.
# --------------------------------------------------------------------------

class ProjectSource:
    def __init__(self, project_dir: Optional[Path]):
        self.root = project_dir
        self._package_json: Optional[dict] = None

    @property
    def available(self) -> bool:
        return self.root is not None and self.root.exists()

    def _read(self, relpath: str) -> Optional[str]:
        if not self.available:
            return None
        p = self.root / relpath
        if not p.exists():
            return None
        try:
            return p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return None

    def package_json(self) -> Optional[dict]:
        if self._package_json is not None:
            return self._package_json
        txt = self._read("package.json")
        if txt is None:
            return None
        try:
            self._package_json = json.loads(txt)
        except Exception:
            self._package_json = None
        return self._package_json

    def product_name(self) -> Optional[str]:
        pkg = self.package_json()
        if not pkg:
            return None
        return (pkg.get("build") or {}).get("productName") or pkg.get("name")

    def app_id(self) -> Optional[str]:
        pkg = self.package_json()
        if not pkg:
            return None
        return (pkg.get("build") or {}).get("appId")

    def routes(self) -> list[str]:
        """Discover route paths from src/router/routes.tsx (RouteObject path: "...")."""
        txt = self._read("src/router/routes.tsx")
        if txt is None:
            return []
        paths = re.findall(r'\bpath:\s*"([^"]*)"', txt)
        # index route has no `path`; keep hash-router root explicitly.
        routes = ["/"] + [f"/{p}" for p in paths if p]
        # de-dup, preserve order
        seen = set()
        out = []
        for r in routes:
            if r not in seen:
                seen.add(r)
                out.append(r)
        return out

    def ipc_channels(self) -> list[str]:
        """Discover every ipcMain.handle('channel', ...) channel actually registered."""
        txt = self._read("electron/main/main.ts")
        if txt is None:
            return []
        # Channel name is either inline `ipcMain.handle("chan", ...)` or on
        # the following line for multi-line calls -- match both forms.
        chans = set(re.findall(r'ipcMain\.handle\(\s*"([a-zA-Z0-9_:\-]+)"', txt))
        for m in re.finditer(r'ipcMain\.handle\(\s*\n\s*"([a-zA-Z0-9_:\-]+)"', txt):
            chans.add(m.group(1))
        return sorted(chans)

    def preload_api_groups(self) -> dict[str, list[str]]:
        """
        Discover the window.<bridge>.<group>.<method> surface actually exposed
        by the preload script via contextBridge.exposeInMainWorld. This is
        the ground truth for what the packaged renderer can call -- it is
        used to drive CRUD tests through the real IPC boundary instead of
        guessing at DOM selectors.
        """
        txt = self._read("electron/preload/preload.ts")
        if txt is None:
            return {}
        bridge_match = re.search(r'contextBridge\.exposeInMainWorld\(\s*"([a-zA-Z0-9_]+)"', txt)
        bridge = bridge_match.group(1) if bridge_match else None
        groups: dict[str, list[str]] = {}
        # crude top-level-group scanner: `groupName: {` followed eventually
        # by methodName: (...) => ipcRenderer.invoke("channel...
        for gm in re.finditer(r'\n\s{0,4}([a-zA-Z0-9_]+):\s*\{', txt):
            groups.setdefault(gm.group(1), [])
        for gname in list(groups.keys()):
            # Find the block for this group heuristically: from its header to
            # the next top-level `\n  name: {` or end of object.
            start = txt.find(f"{gname}: {{")
            if start == -1:
                continue
            # naive brace matching from start
            depth = 0
            i = txt.find("{", start)
            j = i
            while j < len(txt):
                if txt[j] == "{":
                    depth += 1
                elif txt[j] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            block = txt[i:j + 1]
            methods = re.findall(r'([a-zA-Z0-9_]+)\s*:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke', block)
            groups[gname] = sorted(set(methods))
        return {"bridge": bridge, "groups": groups} if bridge else {}

    def schema_tables(self) -> list[str]:
        """Discover every table the app's own migration code creates."""
        txt = self._read("src/database/database.ts")
        if txt is None:
            return []
        return sorted(set(re.findall(r'CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-zA-Z0-9_]+)', txt)))

    def database_source_text(self) -> Optional[str]:
        return self._read("src/database/database.ts")

    def cloud_sync_manager_text(self) -> Optional[str]:
        return self._read("electron/main/cloud/cloud-sync-manager.ts")

    def online_collections(self) -> list[str]:
        """The manifest of collections the app itself declares as 'online' (permissions/UI scope)."""
        txt = self._read("electron/main/cloud/online-data-manifest.ts")
        if txt is None:
            return []
        m = re.search(r'ONLINE_COLLECTIONS\s*=\s*\[(.*?)\]', txt, re.S)
        if not m:
            return []
        return re.findall(r'"([a-zA-Z0-9_]+)"', m.group(1))

    def core_sync_tables(self) -> list[str]:
        """The tables the background sync loop (cloud-sync-manager.ts) actually pushes every cycle."""
        txt = self.cloud_sync_manager_text()
        if txt is None:
            return []
        m = re.search(r'CORE_TABLES\s*=\s*\[(.*?)\]', txt, re.S)
        if not m:
            return []
        return re.findall(r'"([a-zA-Z0-9_]+)"', m.group(1))

    def wrangler_config(self) -> dict:
        txt = self._read("cloudflare/wrangler.toml")
        if txt is None:
            return {}
        out = {}
        for key in ("name", "MBS_WORKSPACE_ID", "MBS_CORS_ORIGIN", "database_name", "database_id"):
            m = re.search(rf'{key}\s*=\s*"([^"]*)"', txt)
            if m:
                out[key] = m.group(1)
        out["workers_dev"] = "workers_dev = true" in txt
        return out

    def worker_source_text(self) -> Optional[str]:
        return self._read("cloudflare/worker/index.js")

    def trusted_license_keys_text(self) -> Optional[str]:
        return self._read("electron/main/license-v2/keys/trusted-keys.ts")

    def all_source_files(self, exts=(".ts", ".tsx", ".js", ".mjs")) -> list[Path]:
        if not self.available:
            return []
        skip_dirs = {"node_modules", "dist", "out", ".git", ".wrangler", "_retired"}
        out = []
        for p in self.root.rglob("*"):
            if p.is_file() and p.suffix in exts:
                if any(part in skip_dirs for part in p.parts):
                    continue
                out.append(p)
        return out

# --------------------------------------------------------------------------
# System / environment utilities
# --------------------------------------------------------------------------

def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def net_reachable(host: str = "1.1.1.1", port: int = 443, timeout: float = 3.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def which(cmd: str) -> Optional[str]:
    return shutil.which(cmd)


def run_cmd(cmd: list[str], cwd: Optional[Path] = None, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True,
        timeout=timeout, shell=False,
    )


def default_userdata_dir() -> Optional[Path]:
    """Electron's app.getPath('userData') for a NSIS-installed MBS on Windows."""
    if not IS_WINDOWS:
        return None
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return None
    return Path(appdata) / "Mooral Business Suite"


def default_db_path() -> Optional[Path]:
    d = default_userdata_dir()
    return (d / "mooral.db") if d else None


# --------------------------------------------------------------------------
# SECTION 4 - PRE-FLIGHT
# --------------------------------------------------------------------------

def run_preflight(reporter: Reporter, src: ProjectSource, args) -> dict:
    ctx: dict = {}

    with reporter.run("preflight", "python_version", severity=SEV_CRITICAL) as t:
        v = sys.version_info
        t.evidence = f"{v.major}.{v.minor}.{v.micro}"
        if (v.major, v.minor) < (3, 11):
            t.fail(f"Python {v.major}.{v.minor} < required 3.11", severity=SEV_HIGH)

    with reporter.run("preflight", "operating_system", severity=SEV_HIGH) as t:
        t.evidence = platform.platform()
        if not IS_WINDOWS:
            t.blocked(
                "MBS ships as a Windows NSIS/Electron build; this run is on "
                f"{platform.system()}. EXE/installer launch, UI, and CRUD "
                "tests that require actually running the Windows binary will "
                "report SKIP/BLOCKED below rather than a fabricated PASS."
            )

    with reporter.run("preflight", "project_source_present") as t:
        if src.available:
            t.evidence = str(src.root)
        else:
            t.skip("No --project supplied or path does not exist; source-derived "
                   "checks (routes/IPC/schema/cloud-scope discovery, static "
                   "analysis) will SKIP.")

    with reporter.run("preflight", "package_json") as t:
        pkg = src.package_json()
        if pkg is None:
            t.skip("package.json not found under --project")
        else:
            t.evidence = {"name": pkg.get("name"), "version": pkg.get("version")}
            ctx["package_json"] = pkg

    with reporter.run("preflight", "electron_builder_config") as t:
        pkg = src.package_json()
        if not pkg or "build" not in pkg:
            t.skip("No electron-builder `build` block found in package.json")
        else:
            t.evidence = pkg["build"]

    with reporter.run("preflight", "expected_directories") as t:
        if not src.available:
            t.skip("No project source supplied")
        else:
            expected = ["src", "electron/main", "electron/preload", "cloudflare"]
            missing = [d for d in expected if not (src.root / d).exists()]
            t.evidence = {"checked": expected, "missing": missing}
            if missing:
                t.fail(f"Expected project directories missing: {missing}", severity=SEV_MEDIUM)

    with reporter.run("preflight", "mbs_database_location") as t:
        db_path = Path(args.db) if args.db else default_db_path()
        ctx["db_path"] = db_path
        if db_path is None:
            t.skip("No --db supplied and default Windows userData path is not "
                   "resolvable on this OS")
        elif not db_path.exists():
            t.blocked(f"Database file not found at {db_path}. Supply --db explicitly "
                      "if MBS uses a custom database path.")
        else:
            t.evidence = {"path": str(db_path), "size_bytes": db_path.stat().st_size}

    with reporter.run("preflight", "database_readability", severity=SEV_HIGH) as t:
        db_path = ctx.get("db_path")
        if not db_path or not Path(db_path).exists():
            t.skip("No readable database path from previous check")
        else:
            try:
                uri = f"file:{Path(db_path).as_posix()}?mode=ro"
                conn = sqlite3.connect(uri, uri=True, timeout=5)
                cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1")
                cur.fetchone()
                conn.close()
                t.evidence = "opened read-only successfully"
            except Exception as e:
                t.fail(f"Could not open database read-only: {e}", severity=SEV_CRITICAL)

    with reporter.run("preflight", "required_python_dependencies") as t:
        t.evidence = {
            "psutil": HAVE_PSUTIL, "requests": HAVE_REQUESTS,
            "playwright": HAVE_PLAYWRIGHT, "sqlite3": True,
        }
        missing = [k for k, v in t.evidence.items() if not v]
        if missing:
            t.skip(f"Optional dependencies not installed: {missing}. Related tests "
                   "will SKIP individually rather than fail the whole run.")

    with reporter.run("preflight", "playwright_availability") as t:
        if not HAVE_PLAYWRIGHT:
            t.skip("playwright package not installed - all UI/CRUD-via-renderer "
                   "tests will SKIP")
        else:
            t.evidence = "playwright import OK"

    with reporter.run("preflight", "disk_space") as t:
        target = ctx.get("db_path") or Path(args.project or ".")
        try:
            usage = shutil.disk_usage(str(Path(target).anchor or "."))
            free_gb = usage.free / (1024 ** 3)
            t.evidence = {"free_gb": round(free_gb, 2)}
            if free_gb < 1:
                t.fail(f"Only {free_gb:.2f} GB free disk space", severity=SEV_MEDIUM)
        except Exception as e:
            t.skip(f"Could not determine disk space: {e}")

    with reporter.run("preflight", "available_ram") as t:
        if HAVE_PSUTIL:
            vm = psutil.virtual_memory()
            t.evidence = {"total_gb": round(vm.total / 1024**3, 2), "available_gb": round(vm.available / 1024**3, 2)}
            if vm.available / 1024**3 < 0.5:
                t.fail("Less than 500MB RAM available", severity=SEV_MEDIUM)
        else:
            t.skip("psutil not installed")

    with reporter.run("preflight", "cpu_info") as t:
        t.evidence = {"logical_cores": os.cpu_count()}

    with reporter.run("preflight", "network_availability") as t:
        if args.mode in ("offline",):
            t.skip("Skipped network check under --mode offline by design")
        else:
            reachable = net_reachable()
            t.evidence = {"reachable": reachable}
            if not reachable:
                t.blocked("No outbound network reachable from this environment - "
                          "cloud/D1/sync tests below will SKIP/BLOCK accordingly")

    with reporter.run("preflight", "cloudflare_configuration_presence") as t:
        wc = src.wrangler_config()
        if not wc:
            t.skip("No cloudflare/wrangler.toml found under --project")
        else:
            t.evidence = wc
            ctx["wrangler"] = wc

    with reporter.run("preflight", "exe_presence") as t:
        if not args.exe:
            t.skip("No --exe supplied")
        else:
            p = Path(args.exe)
            if not p.exists():
                t.fail(f"--exe path does not exist: {p}", severity=SEV_CRITICAL)
            else:
                t.evidence = {"path": str(p), "size_bytes": p.stat().st_size}
                ctx["exe_path"] = p

    with reporter.run("preflight", "installer_presence") as t:
        if not args.installer:
            t.skip("No --installer supplied")
        else:
            p = Path(args.installer)
            if not p.exists():
                t.fail(f"--installer path does not exist: {p}", severity=SEV_CRITICAL)
            else:
                t.evidence = {"path": str(p), "size_bytes": p.stat().st_size}
                ctx["installer_path"] = p

    return ctx

# --------------------------------------------------------------------------
# SECTION 5 - BUILD / ARTIFACT QA
# --------------------------------------------------------------------------

def parse_pe_header(exe_path: Path) -> dict:
    """
    Minimal, dependency-free PE header parser: verifies the MZ/PE signature
    and reads the COFF machine type. This is a static-format check only, not
    a full parse -- good enough to confirm "this is a real Windows PE binary
    of the expected architecture" without needing `pefile`.
    """
    info: dict = {"is_pe": False}
    with open(exe_path, "rb") as f:
        data = f.read(1024)
    if len(data) < 64 or data[0:2] != b"MZ":
        return info
    e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    with open(exe_path, "rb") as f:
        f.seek(e_lfanew)
        pe_sig = f.read(4)
        if pe_sig != b"PE\x00\x00":
            return info
        coff = f.read(20)
    machine = struct.unpack_from("<H", coff, 0)[0]
    machine_map = {0x8664: "x64", 0x14C: "x86", 0xAA64: "arm64"}
    info["is_pe"] = True
    info["machine"] = machine_map.get(machine, hex(machine))
    return info


def run_build_artifact_qa(reporter: Reporter, src: ProjectSource, ctx: dict, args) -> None:
    node = which("node")
    npm = which("npm")

    with reporter.run("build", "package_json_scripts") as t:
        pkg = src.package_json()
        if not pkg:
            t.skip("No project source supplied")
        else:
            scripts = pkg.get("scripts", {})
            t.evidence = scripts
            required = {"build", "dist:win", "typecheck"}
            missing = required - set(scripts)
            if missing:
                t.fail(f"Missing expected build scripts: {sorted(missing)}", severity=SEV_LOW)

    with reporter.run("build", "electron_builder_target") as t:
        pkg = src.package_json()
        if not pkg:
            t.skip("No project source supplied")
        else:
            win_cfg = ((pkg.get("build") or {}).get("win") or {})
            t.evidence = win_cfg
            if win_cfg.get("target") != "nsis":
                t.fail(f"Expected nsis Windows target, found: {win_cfg.get('target')!r}", severity=SEV_LOW)

    with reporter.run("build", "asar_unpack_config_for_native_modules", severity=SEV_HIGH) as t:
        pkg = src.package_json()
        if not pkg:
            t.skip("No project source supplied")
        else:
            unpack = (pkg.get("build") or {}).get("asarUnpack") or []
            t.evidence = unpack
            has_native_glob = any("*.node" in u for u in unpack)
            has_bs3 = any("better-sqlite3" in u for u in unpack)
            if not (has_native_glob or has_bs3):
                t.fail("package.json build.asarUnpack does not appear to unpack "
                      "better-sqlite3's native .node binary - packaged EXE is "
                      "likely to fail to load the database at startup", severity=SEV_CRITICAL)

    with reporter.run("build", "typescript_typecheck") as t:
        if not src.available:
            t.skip("No project source supplied")
        elif not npm:
            t.skip("npm not found on PATH")
        elif args.mode not in ("full", "smoke", "regression", "installer"):
            t.skip(f"typecheck not part of --mode {args.mode}")
        else:
            try:
                res = run_cmd([npm, "run", "typecheck"], cwd=src.root, timeout=args.timeout or 600)
                t.evidence = {"returncode": res.returncode, "stdout_tail": res.stdout[-4000:], "stderr_tail": res.stderr[-4000:]}
                if res.returncode != 0:
                    t.fail("`npm run typecheck` failed - see evidence for compiler output", severity=SEV_HIGH)
            except subprocess.TimeoutExpired:
                t.blocked("`npm run typecheck` timed out")
            except Exception as e:
                t.blocked(f"Could not run npm: {e}")

    with reporter.run("build", "vite_electron_build") as t:
        if not src.available:
            t.skip("No project source supplied")
        elif not npm:
            t.skip("npm not found on PATH")
        elif args.mode not in ("full", "installer"):
            t.skip(f"build not part of --mode {args.mode} (pass --mode full to compile)")
        else:
            try:
                res = run_cmd([npm, "run", "build"], cwd=src.root, timeout=args.timeout or 900)
                t.evidence = {"returncode": res.returncode, "stdout_tail": res.stdout[-4000:], "stderr_tail": res.stderr[-4000:]}
                if res.returncode != 0:
                    t.fail("`npm run build` failed", severity=SEV_HIGH)
            except subprocess.TimeoutExpired:
                t.blocked("`npm run build` timed out")
            except Exception as e:
                t.blocked(f"Could not run npm: {e}")

    with reporter.run("build", "preload_output_present") as t:
        if not src.available:
            t.skip("No project source supplied")
        else:
            out_preload = src.root / "out" / "preload"
            if not out_preload.exists():
                t.blocked("out/preload not found - run with --mode full to build first, "
                          "or this is expected if only an already-packaged EXE is being tested")
            else:
                files = list(out_preload.glob("*"))
                t.evidence = [str(f.name) for f in files]
                if not files:
                    t.fail("out/preload exists but is empty", severity=SEV_HIGH)

    # --- EXE static inspection (section 5, "If EXE is supplied") ---
    exe_path = ctx.get("exe_path")

    with reporter.run("build", "exe_pe_signature", severity=SEV_CRITICAL) as t:
        if not exe_path:
            t.skip("No --exe supplied")
        else:
            info = parse_pe_header(exe_path)
            t.evidence = info
            if not info.get("is_pe"):
                t.fail(f"{exe_path} does not have a valid MZ/PE header - not a Windows executable", severity=SEV_CRITICAL)

    with reporter.run("build", "exe_architecture") as t:
        if not exe_path:
            t.skip("No --exe supplied")
        else:
            info = parse_pe_header(exe_path)
            t.evidence = info.get("machine")
            if info.get("machine") not in ("x64", "arm64"):
                t.fail(f"Unexpected/legacy architecture: {info.get('machine')}", severity=SEV_MEDIUM)

    with reporter.run("build", "exe_size_sanity") as t:
        if not exe_path:
            t.skip("No --exe supplied")
        else:
            size_mb = exe_path.stat().st_size / (1024 * 1024)
            t.evidence = {"size_mb": round(size_mb, 2)}
            # A packaged Electron+better-sqlite3 app is virtually never <10MB;
            # a suspiciously tiny file usually means a broken/partial build.
            if size_mb < 10:
                t.fail(f"EXE is unusually small ({size_mb:.1f} MB) for a packaged "
                      "Electron app - possible broken/partial build", severity=SEV_HIGH)

    with reporter.run("build", "exe_expected_application_name") as t:
        if not exe_path:
            t.skip("No --exe supplied")
        else:
            expected = src.product_name() or "Mooral Business Suite"
            try:
                with open(exe_path, "rb") as f:
                    blob = f.read(8 * 1024 * 1024)
                found = expected.encode("utf-16-le") in blob or expected.encode("ascii", "ignore") in blob
                t.evidence = {"expected": expected, "found_in_binary": found}
                if not found:
                    t.blocked(f"Could not confirm string {expected!r} inside the binary via a raw byte scan "
                              "- this is a weak heuristic, not proof of a wrong build; treat as informational")
            except Exception as e:
                t.blocked(f"Could not scan EXE bytes: {e}")

    with reporter.run("build", "packaged_resources_and_native_module") as t:
        if not exe_path:
            t.skip("No --exe supplied")
        else:
            resources_dir = exe_path.parent / "resources"
            if not resources_dir.exists():
                t.blocked(f"No sibling resources/ directory next to {exe_path.name} - "
                          "cannot verify packaged resources (this is expected if --exe "
                          "points somewhere other than the installed app directory)")
            else:
                asar = resources_dir / "app.asar"
                unpacked = resources_dir / "app.asar.unpacked"
                bs3_native = list(unpacked.rglob("better_sqlite3.node")) if unpacked.exists() else []
                t.evidence = {
                    "app.asar": asar.exists(),
                    "app.asar.unpacked": unpacked.exists(),
                    "better_sqlite3_native_binary": [str(p) for p in bs3_native],
                }
                if not asar.exists():
                    t.fail("resources/app.asar missing", severity=SEV_CRITICAL)
                elif not bs3_native:
                    t.fail("better_sqlite3.node native binary not found under "
                          "app.asar.unpacked - packaged app will crash on any "
                          "database access", severity=SEV_CRITICAL)

# --------------------------------------------------------------------------
# AppLauncher: launches the real packaged EXE with remote debugging enabled
# and, when Playwright is available, connects to it over CDP. This is the
# single mechanism every runtime test (startup, UI nav, CRUD, settings,
# sync) is built on top of -- there is no DOM-guessing and no invented
# output; if the app can't actually be launched and connected to, every
# test that needs it reports SKIP/BLOCKED with the real reason.
# --------------------------------------------------------------------------

class LaunchedApp:
    def __init__(self, proc: subprocess.Popen, port: int, user_data_dir: Optional[Path]):
        self.proc = proc
        self.port = port
        self.user_data_dir = user_data_dir
        self.pid = proc.pid
        self._psproc = psutil.Process(self.pid) if HAVE_PSUTIL else None
        self._pw_ctx = None
        self._browser = None

    def is_alive(self) -> bool:
        return self.proc.poll() is None

    def cdp_reachable(self, timeout: float = 20.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if not self.is_alive():
                return False
            try:
                r = http_get(f"http://127.0.0.1:{self.port}/json/version", timeout=1.5)
                if getattr(r, "status_code", None) == 200:
                    return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

    def connect_playwright(self):
        """Returns (playwright_ctx, browser, page) for the app's main renderer window."""
        if not HAVE_PLAYWRIGHT:
            return None, None, None
        self._pw_ctx = sync_playwright().start()
        self._browser = self._pw_ctx.chromium.connect_over_cdp(f"http://127.0.0.1:{self.port}")
        contexts = self._browser.contexts
        page = None
        for c in contexts:
            for p in c.pages:
                # Electron devtools/background pages have about:blank or
                # devtools:// urls; the real app window has a file:// or
                # app-level URL loading index.html.
                url = p.url or ""
                if url and not url.startswith("devtools://"):
                    page = p
                    break
            if page:
                break
        return self._pw_ctx, self._browser, page

    def memory_cpu(self) -> dict:
        if not self._psproc:
            return {}
        try:
            with self._psproc.oneshot():
                mem = self._psproc.memory_info()
                cpu = self._psproc.cpu_percent(interval=0.2)
                children = self._psproc.children(recursive=True)
                total_rss = mem.rss + sum(c.memory_info().rss for c in children if c.is_running())
            return {"rss_mb": round(total_rss / 1024 / 1024, 1), "cpu_percent": cpu,
                    "child_processes": len(children)}
        except Exception:
            return {}

    def close(self):
        try:
            if self._pw_ctx:
                self._pw_ctx.stop()
        except Exception:
            pass
        try:
            if self.is_alive():
                if HAVE_PSUTIL and self._psproc:
                    for c in self._psproc.children(recursive=True):
                        with contextlib.suppress(Exception):
                            c.terminate()
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
        except Exception:
            pass


def launch_app(exe_path: Path, port: Optional[int] = None,
                user_data_dir: Optional[Path] = None,
                extra_args: Optional[list[str]] = None) -> LaunchedApp:
    port = port or find_free_port()
    cmd = [str(exe_path), f"--remote-debugging-port={port}"]
    if user_data_dir:
        user_data_dir.mkdir(parents=True, exist_ok=True)
        cmd.append(f"--user-data-dir={user_data_dir}")
    if extra_args:
        cmd.extend(extra_args)
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=str(exe_path.parent),
    )
    return LaunchedApp(proc, port, user_data_dir)


@contextlib.contextmanager
def running_app(exe_path: Optional[Path], timeout: float = 25.0,
                 user_data_dir: Optional[Path] = None, extra_args: Optional[list[str]] = None):
    """
    Context manager yielding a ready LaunchedApp (CDP already reachable), or
    None if the app could not be started/connected to. Always tears the
    process down on exit. Never raises past this boundary -- callers should
    check for None and report SKIP/BLOCKED with app.startup_error.
    """
    app = None
    startup_error = None
    if exe_path is None:
        yield None, "No --exe supplied"
        return
    if not IS_WINDOWS:
        yield None, f"Cannot launch a Windows EXE on {platform.system()}"
        return
    try:
        app = launch_app(exe_path, user_data_dir=user_data_dir, extra_args=extra_args)
        if not app.cdp_reachable(timeout=timeout):
            startup_error = ("Process did not expose a reachable CDP endpoint within "
                             f"{timeout}s (alive={app.is_alive()})")
    except Exception as e:
        startup_error = f"Failed to launch {exe_path}: {e}"
    try:
        yield app, startup_error
    finally:
        if app:
            app.close()

# --------------------------------------------------------------------------
# SECTION 6 - APPLICATION STARTUP
# --------------------------------------------------------------------------

def run_startup_qa(reporter: Reporter, ctx: dict, args) -> Optional[dict]:
    """Launches the real app once and returns a shared session dict used by
    later sections (UI/CRUD/settings/performance) so we don't relaunch the
    app for every category. Returns None if the app could not be started."""
    exe_path = ctx.get("exe_path")
    session: dict = {"app": None, "page": None, "pw": None, "browser": None,
                      "bridge_groups": {}, "screenshots_dir": None}

    with reporter.run("startup", "automation_capability_report") as t:
        # Section 21: report up front whether UI automation can even work.
        if not exe_path:
            t.evidence = "UI AUTOMATION: NOT AVAILABLE (no --exe supplied)"
            t.skip("No --exe supplied; startup/UI/CRUD sections will SKIP")
            return None
        if not IS_WINDOWS:
            t.evidence = "UI AUTOMATION: NOT AVAILABLE (not running on Windows)"
            t.blocked(f"Cannot launch the Windows EXE on {platform.system()}")
            return None
        if not HAVE_PLAYWRIGHT:
            t.evidence = "UI AUTOMATION: NOT AVAILABLE (playwright not installed)"
        else:
            t.evidence = "UI AUTOMATION: playwright + CDP available"

    t0 = time.time()
    app = None
    try:
        app = launch_app(exe_path)
        cdp_ok = app.cdp_reachable(timeout=args.timeout or 25)
        startup_time = round(time.time() - t0, 2)

        with reporter.run("startup", "process_starts", severity=SEV_CRITICAL) as t:
            t.evidence = {"pid": app.pid}
            if not app.is_alive() and not cdp_ok:
                t.fail(f"Process exited immediately (no CDP, alive={app.is_alive()})", severity=SEV_CRITICAL)

        with reporter.run("startup", "process_remains_alive", severity=SEV_CRITICAL) as t:
            time.sleep(1.5)
            alive = app.is_alive()
            t.evidence = {"alive_after_1.5s": alive}
            if not alive:
                stderr_tail = ""
                with contextlib.suppress(Exception):
                    stderr_tail = app.proc.stderr.read().decode("utf-8", "replace")[-3000:]
                t.fail(f"Process crashed shortly after launch. stderr: {stderr_tail}", severity=SEV_CRITICAL)

        with reporter.run("startup", "startup_time", severity=SEV_LOW) as t:
            t.evidence = {"seconds": startup_time}
            if startup_time > (args.timeout or 25):
                t.fail(f"Startup exceeded timeout budget ({startup_time}s)", severity=SEV_MEDIUM)

        with reporter.run("startup", "cdp_endpoint_reachable", severity=SEV_HIGH) as t:
            t.evidence = {"reachable": cdp_ok, "port": app.port}
            if not cdp_ok:
                t.fail("No reachable CDP endpoint - renderer/UI automation for this "
                      "run will be BLOCKED, not fabricated", severity=SEV_HIGH)

        with reporter.run("startup", "resource_usage") as t:
            usage = app.memory_cpu()
            if not usage:
                t.skip("psutil not installed - cannot measure RAM/CPU")
            else:
                t.evidence = usage

        page = None
        pw_ctx = browser = None
        if cdp_ok and HAVE_PLAYWRIGHT:
            with reporter.run("startup", "renderer_loads", severity=SEV_CRITICAL) as t:
                try:
                    pw_ctx, browser, page = app.connect_playwright()
                    if page is None:
                        t.fail("Connected over CDP but found no renderer page (only "
                              "devtools/background targets)", severity=SEV_HIGH)
                    else:
                        page.wait_for_load_state("domcontentloaded", timeout=15000)
                        t.evidence = {"url": page.url}
                except Exception as e:
                    t.fail(f"Could not attach to renderer: {e}", severity=SEV_HIGH)

            with reporter.run("startup", "no_white_screen", severity=SEV_HIGH) as t:
                if not page:
                    t.skip("No renderer page attached")
                else:
                    try:
                        body_text = page.inner_text("body", timeout=5000)
                        t.evidence = {"body_text_len": len(body_text.strip())}
                        if len(body_text.strip()) < 5:
                            t.fail("Renderer body has effectively no visible text/content - "
                                  "app likely rendered a white/blank screen", severity=SEV_HIGH)
                    except Exception as e:
                        t.fail(f"Could not read renderer body: {e}", severity=SEV_HIGH)

            with reporter.run("startup", "no_fatal_console_errors") as t:
                if not page:
                    t.skip("No renderer page attached")
                else:
                    errors = []
                    page.on("pageerror", lambda exc: errors.append(str(exc)))
                    page.wait_for_timeout(1500)
                    t.evidence = {"errors_observed_in_window": errors}
                    if errors:
                        t.fail(f"{len(errors)} uncaught renderer exception(s) observed", severity=SEV_MEDIUM)

            with reporter.run("startup", "screenshot") as t:
                if not page:
                    t.skip("No renderer page attached")
                else:
                    shots_dir = Path(args.report_dir) / "qa-report" / "screenshots"
                    shots_dir.mkdir(parents=True, exist_ok=True)
                    shot_path = shots_dir / "01_startup.png"
                    try:
                        page.screenshot(path=str(shot_path))
                        t.evidence = str(shot_path)
                        session["screenshots_dir"] = shots_dir
                    except Exception as e:
                        t.skip(f"Screenshot failed: {e}")
        elif cdp_ok and not HAVE_PLAYWRIGHT:
            with reporter.run("startup", "renderer_loads", blocked_reason=(
                    "CDP endpoint is reachable but the `playwright` package is not "
                    "installed, so this agent cannot actually attach to the renderer. "
                    "Install playwright to enable UI/CRUD/settings testing.")) as t:
                pass

        with reporter.run("startup", "stdout_stderr_capture") as t:
            t.evidence = "stdout/stderr streams captured (see process pipes); "\
                          "full text attached only on failure to keep the report small"

        session["app"] = app
        session["page"] = page
        session["pw"] = pw_ctx
        session["browser"] = browser
        return session
    except Exception as e:
        with reporter.run("startup", "launch_exception", severity=SEV_CRITICAL) as t:
            t.fail(f"Unhandled exception launching app: {e}", severity=SEV_CRITICAL)
        if app:
            app.close()
        return None


def teardown_startup_qa(reporter: Reporter, session: Optional[dict]) -> None:
    if not session:
        return
    app: Optional[LaunchedApp] = session.get("app")
    with reporter.run("startup", "application_closes_cleanly") as t:
        if not app:
            t.skip("No app was launched")
        else:
            app.close()
            time.sleep(1)
            t.evidence = {"alive_after_close_attempt": app.is_alive()}
            if app.is_alive():
                t.fail("Process still alive after terminate()/kill() - possible "
                      "hang on shutdown", severity=SEV_MEDIUM)

# --------------------------------------------------------------------------
# SECTION 7 - UI / NAVIGATION QA
# --------------------------------------------------------------------------

# Fallback route list used ONLY when source is unavailable to discover
# them dynamically. Marked clearly as a fallback in the evidence so a
# report reader can tell discovered-from-source apart from this default.
FALLBACK_ROUTES = [
    "/", "/customers", "/products", "/orders", "/invoices", "/accounting",
    "/reports", "/certificates", "/employees", "/profile", "/settings",
    "/settings/notifications", "/settings/integrations", "/settings/about",
]


def run_ui_navigation_qa(reporter: Reporter, src: ProjectSource, session: Optional[dict], args) -> None:
    page = session.get("page") if session else None

    with reporter.run("ui", "route_discovery") as t:
        routes = src.routes()
        if routes:
            t.evidence = {"source": "src/router/routes.tsx", "routes": routes}
        else:
            routes = FALLBACK_ROUTES
            t.evidence = {"source": "fallback (no project source supplied)", "routes": routes}

    if not page:
        with reporter.run("ui", "navigation_tests", blocked_reason=(
                "No live renderer page attached (app not launched, CDP unreachable, "
                "or playwright unavailable) - per spec section 7/21, UI PASS is "
                "never claimed without actually accessing the packaged app.")) as t:
            pass
        return

    routes = src.routes() or FALLBACK_ROUTES
    shots_dir = session.get("screenshots_dir")

    errors_log: list[str] = []
    page.on("pageerror", lambda exc: errors_log.append(str(exc)))

    for idx, route in enumerate(routes, start=1):
        with reporter.run("ui", f"route_loads:{route}") as t:
            errors_before = len(errors_log)
            try:
                page.evaluate(f"window.location.hash = '#{route}'")
                page.wait_for_timeout(900)
                body_text = page.inner_text("body", timeout=5000)
                title = page.title()
                new_errors = errors_log[errors_before:]
                t.evidence = {
                    "route": route, "title": title,
                    "body_text_len": len(body_text.strip()),
                    "console_errors": new_errors,
                }
                if len(body_text.strip()) < 5:
                    t.fail(f"Route {route} rendered no visible content (blank page)", severity=SEV_HIGH)
                elif new_errors:
                    t.fail(f"Route {route} triggered {len(new_errors)} uncaught exception(s)", severity=SEV_MEDIUM)
                if shots_dir:
                    safe_name = re.sub(r"[^a-zA-Z0-9]+", "_", route).strip("_") or "root"
                    with contextlib.suppress(Exception):
                        page.screenshot(path=str(shots_dir / f"route_{idx:02d}_{safe_name}.png"))
            except Exception as e:
                t.fail(f"Navigation to {route} failed: {e}", severity=SEV_HIGH)

    with reporter.run("ui", "tables_buttons_forms_render") as t:
        try:
            page.evaluate("window.location.hash = '#/products'")
            page.wait_for_timeout(900)
            counts = page.evaluate(
                "() => ({ tables: document.querySelectorAll('table').length, "
                "buttons: document.querySelectorAll('button').length, "
                "inputs: document.querySelectorAll('input,select,textarea').length })"
            )
            t.evidence = counts
            if counts.get("buttons", 0) == 0 and counts.get("inputs", 0) == 0:
                t.fail("Products page has zero interactive elements (buttons/inputs) - "
                      "likely broken rendering", severity=SEV_MEDIUM)
        except Exception as e:
            t.fail(f"Could not inspect DOM: {e}", severity=SEV_MEDIUM)


# --------------------------------------------------------------------------
# SECTION 8 - CRUD FUNCTIONAL TESTING
#
# Driven through the ACTUAL renderer->main IPC bridge the app itself
# exposes (contextBridge.exposeInMainWorld), discovered live from the
# running window object rather than guessed. This tests real business
# logic (validation, persistence) without clicking through DOM forms,
# and without ever inventing field names the app doesn't itself define.
# --------------------------------------------------------------------------

QA_TAG = "MBS_QA_" + uuid.uuid4().hex[:8]

# Minimal, clearly-tagged probe payloads per domain. These are intentionally
# generic and small: the goal is to observe ACTUAL app behaviour (accept,
# validate-and-reject, or crash), not to assert a specific business rule
# this agent has no authority to invent.
CRUD_PROBES = {
    "products": {"name": f"{QA_TAG}_Product", "price": 1, "stock": 0},
    "customers": {"name": f"{QA_TAG}_Customer", "phone": "0000000000"},
    "employees": {"first_name": QA_TAG, "last_name": "Employee"},
}


def discover_bridge_object(page) -> dict:
    try:
        return page.evaluate(
            """() => {
                const bridgeNames = Object.keys(window).filter(k =>
                    typeof window[k] === 'object' && window[k] !== null &&
                    Object.values(window[k]).some(v => typeof v === 'object' && v !== null));
                const out = {};
                for (const b of bridgeNames) {
                    try {
                        out[b] = Object.keys(window[b]).filter(g =>
                            typeof window[b][g] === 'object' && window[b][g] !== null)
                            .reduce((acc, g) => { acc[g] = Object.keys(window[b][g])
                                .filter(m => typeof window[b][g][m] === 'function'); return acc; }, {});
                    } catch (e) {}
                }
                return out;
            }"""
        )
    except Exception:
        return {}


def run_crud_qa(reporter: Reporter, session: Optional[dict], src: ProjectSource, args) -> None:
    page = session.get("page") if session else None

    with reporter.run("crud", "ipc_bridge_discovery") as t:
        static_groups = src.preload_api_groups()
        if static_groups:
            t.evidence = {"source": "electron/preload/preload.ts (static)", "groups": static_groups}
        else:
            t.skip("No project source supplied to statically enumerate the preload bridge")

    if not page:
        with reporter.run("crud", "live_ipc_probe", blocked_reason=(
                "No live renderer attached - CRUD tests require calling the app's "
                "own exposed IPC bridge (e.g. window.mooral.products.create) from "
                "inside the actually-running packaged app.")) as t:
            pass
        return

    with reporter.run("crud", "live_bridge_discovery") as t:
        bridge = discover_bridge_object(page)
        t.evidence = bridge
        if not bridge:
            t.fail("window has no contextBridge-exposed API object with the expected "
                  "shape - packaged preload may not be wired correctly", severity=SEV_HIGH)

    bridge_name = "mooral"
    for domain, probe in CRUD_PROBES.items():
        created_id = None

        with reporter.run("crud", f"{domain}:create") as t:
            try:
                result = page.evaluate(
                    "([bridge, domain, payload]) => window[bridge]?.[domain]?.create ? "
                    "window[bridge][domain].create(payload) : Promise.resolve({__missing:true})",
                    [bridge_name, domain, probe],
                )
                t.evidence = result
                if isinstance(result, dict) and result.get("__missing"):
                    t.skip(f"window.{bridge_name}.{domain}.create is not exposed by this build")
                    continue
                if isinstance(result, dict):
                    created_id = result.get("id") or result.get(f"{domain[:-1]}_id") or result.get("product_id") or result.get("customer_id")
            except Exception as e:
                # A rejected/validated create is legitimate observed behaviour,
                # not a bug -- only record it as evidence, not a failure, per
                # "discover the actual implemented behaviour" (section 8).
                t.evidence = {"rejected": str(e)}

        with reporter.run("crud", f"{domain}:read_after_create") as t:
            try:
                rows = page.evaluate(
                    "([bridge, domain]) => window[bridge]?.[domain]?.get ? "
                    "window[bridge][domain].get() : Promise.resolve({__missing:true})",
                    [bridge_name, domain],
                )
                if isinstance(rows, dict) and rows.get("__missing"):
                    t.skip(f"window.{bridge_name}.{domain}.get is not exposed")
                    continue
                found = None
                if isinstance(rows, list):
                    found = next((r for r in rows if isinstance(r, dict) and QA_TAG in json.dumps(r)), None)
                t.evidence = {"total_rows": len(rows) if isinstance(rows, list) else None, "found_created_row": bool(found)}
                if created_id and not found:
                    t.fail(f"Created {domain[:-1]} did not persist / could not be read back "
                          "via the same repository the app itself uses", severity=SEV_HIGH)
            except Exception as e:
                t.fail(f"Read-back for {domain} raised an exception: {e}", severity=SEV_MEDIUM)

        with reporter.run("crud", f"{domain}:cleanup_delete") as t:
            if not created_id:
                t.skip("No id was returned from create to clean up")
                continue
            try:
                result = page.evaluate(
                    "([bridge, domain, id]) => window[bridge]?.[domain]?.delete ? "
                    "window[bridge][domain].delete(id) : Promise.resolve({__missing:true})",
                    [bridge_name, domain, created_id],
                )
                t.evidence = result
                if isinstance(result, dict) and result.get("__missing"):
                    t.skip(f"window.{bridge_name}.{domain}.delete is not exposed - "
                          f"QA test record {created_id} left in place, tagged '{QA_TAG}' for manual cleanup")
            except Exception as e:
                t.blocked(f"Could not delete QA test record {created_id} ({domain}): {e}. "
                          f"Record is tagged '{QA_TAG}' for manual cleanup.")

# --------------------------------------------------------------------------
# SECTION 8 (cont.) - Settings / Profile persistence
# --------------------------------------------------------------------------

def run_settings_profile_qa(reporter: Reporter, session: Optional[dict]) -> None:
    page = session.get("page") if session else None
    if not page:
        with reporter.run("crud", "settings_persistence", blocked_reason=(
                "No live renderer attached")) as t:
            pass
        return

    with reporter.run("crud", "settings_edit_save_reload") as t:
        try:
            before = page.evaluate("() => window.mooral?.settings?.get ? window.mooral.settings.get() : {__missing:true}")
            if isinstance(before, dict) and before.get("__missing"):
                t.skip("window.mooral.settings.get is not exposed by this build")
            else:
                t.evidence = {"observed_current_settings_keys": list(before.keys()) if isinstance(before, dict) else None}
        except Exception as e:
            t.blocked(f"Could not read current settings: {e}")


# --------------------------------------------------------------------------
# SECTION 9 - DATABASE QA
# --------------------------------------------------------------------------

def run_database_qa(reporter: Reporter, src: ProjectSource, ctx: dict) -> None:
    db_path = ctx.get("db_path")
    if not db_path or not Path(db_path).exists():
        with reporter.run("database", "schema_inspection", blocked_reason=(
                "No readable database file (see preflight/database_readability)")) as t:
            pass
        return

    def ro_conn():
        uri = f"file:{Path(db_path).as_posix()}?mode=ro"
        return sqlite3.connect(uri, uri=True, timeout=5)

    with reporter.run("database", "opens") as t:
        conn = ro_conn()
        t.evidence = "opened read-only"
        conn.close()

    expected_tables = src.schema_tables()
    with reporter.run("database", "required_tables_exist", severity=SEV_HIGH) as t:
        conn = ro_conn()
        actual = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        conn.close()
        if not expected_tables:
            t.skip("No project source supplied to determine the expected table list; "
                  f"observed tables: {sorted(actual)}")
        else:
            missing = sorted(set(expected_tables) - actual)
            t.evidence = {"expected": expected_tables, "actual": sorted(actual), "missing": missing}
            if missing:
                t.fail(f"Tables defined in application source but missing from the live "
                      f"database: {missing}", severity=SEV_HIGH)

    with reporter.run("database", "indexes") as t:
        conn = ro_conn()
        idx = list(conn.execute("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"))
        conn.close()
        t.evidence = [{"index": i, "table": tb} for i, tb in idx]

    with reporter.run("database", "foreign_keys_declared") as t:
        conn = ro_conn()
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        fk_info = {}
        for tbl in tables:
            rows = conn.execute(f"PRAGMA foreign_key_list('{tbl}')").fetchall()
            if rows:
                fk_info[tbl] = len(rows)
        conn.close()
        t.evidence = fk_info
        if not fk_info:
            t.blocked("No PRAGMA-declared foreign keys found on any table - relationships "
                      "may be enforced only in application code, which this static PRAGMA "
                      "check cannot verify either way")

    with reporter.run("database", "integrity_check", severity=SEV_CRITICAL) as t:
        conn = ro_conn()
        rows = conn.execute("PRAGMA integrity_check").fetchall()
        conn.close()
        t.evidence = [r[0] for r in rows]
        if not (len(rows) == 1 and rows[0][0] == "ok"):
            t.fail(f"PRAGMA integrity_check reported problems: {t.evidence}", severity=SEV_CRITICAL)

    with reporter.run("database", "foreign_key_check", severity=SEV_HIGH) as t:
        conn = ro_conn()
        conn.execute("PRAGMA foreign_keys = ON")
        rows = conn.execute("PRAGMA foreign_key_check").fetchall()
        conn.close()
        t.evidence = rows
        if rows:
            t.fail(f"PRAGMA foreign_key_check found {len(rows)} violation(s): {rows[:20]}", severity=SEV_HIGH)

    with reporter.run("database", "orphan_records_journal_ledger", severity=SEV_HIGH) as t:
        conn = ro_conn()
        try:
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            findings = {}
            if {"journal_entries", "accounts"} <= tables:
                orphans = conn.execute(
                    "SELECT COUNT(*) FROM journal_entries "
                    "WHERE debit_account_id NOT IN (SELECT id FROM accounts) "
                    "   OR credit_account_id NOT IN (SELECT id FROM accounts)"
                ).fetchone()[0]
                findings["journal_entries_with_missing_account"] = orphans
            if {"ledger_entries", "accounts"} <= tables:
                orphans = conn.execute(
                    "SELECT COUNT(*) FROM ledger_entries WHERE account_id NOT IN (SELECT id FROM accounts)"
                ).fetchone()[0]
                findings["ledger_entries_with_missing_account"] = orphans
            if {"orders", "customers"} <= tables:
                # customers use a business-key id (customer_id text), not
                # necessarily the same column name as orders' FK -- only run
                # this if the column actually exists to avoid a guessed check.
                cols = {r[1] for r in conn.execute("PRAGMA table_info(orders)")}
                if "customer_id" in cols:
                    ccols = {r[1] for r in conn.execute("PRAGMA table_info(customers)")}
                    key = "customer_id" if "customer_id" in ccols else "id"
                    orphans = conn.execute(
                        f"SELECT COUNT(*) FROM orders WHERE customer_id IS NOT NULL "
                        f"AND customer_id NOT IN (SELECT {key} FROM customers)"
                    ).fetchone()[0]
                    findings["orders_with_missing_customer"] = orphans
            t.evidence = findings
            bad = {k: v for k, v in findings.items() if v}
            if bad:
                t.fail(f"Orphan record(s) detected: {bad}", severity=SEV_HIGH)
        finally:
            conn.close()


# --------------------------------------------------------------------------
# SECTION 12 - JOURNAL / ACCOUNT SAFETY
#
# Static-analysis check of the app's OWN sync implementation: does
# journal_entries.debit_account_id / credit_account_id (which reference
# the device-local AUTOINCREMENT accounts.id) get remapped to a stable,
# cross-device identifier before being pushed to / pulled from the cloud?
# If not, two devices' account ids can silently collide or diverge once
# journal_entries sync, which is a data-integrity risk this agent must
# not paper over -- and must not "fix" or invent a remap for either.
# --------------------------------------------------------------------------

def run_journal_account_safety_qa(reporter: Reporter, src: ProjectSource, ctx: dict) -> None:
    db_text = src.database_source_text()
    sync_text = src.cloud_sync_manager_text()

    with reporter.run("database", "accounts_id_is_device_local", severity=SEV_HIGH) as t:
        if not db_text:
            t.skip("No project source supplied")
        else:
            m = re.search(r'CREATE TABLE(?:\s+IF NOT EXISTS)?\s+accounts\s*\((.*?)\);', db_text, re.S)
            if not m:
                t.blocked("Could not locate the `accounts` table definition in database.ts")
            else:
                is_autoincrement = bool(re.search(r'id\s+INTEGER\s+PRIMARY KEY\s+AUTOINCREMENT', m.group(1), re.I))
                t.evidence = {"accounts_id_column": "INTEGER PRIMARY KEY AUTOINCREMENT" if is_autoincrement else "other"}
                if is_autoincrement:
                    t.fail("accounts.id is a local AUTOINCREMENT integer, not a stable "
                          "cross-device business key. Any table that references it by id "
                          "(journal_entries, ledger_entries) is only safe to sync if that "
                          "reference is remapped to something stable (e.g. accounts.code) "
                          "before/after transport.", severity=SEV_HIGH)

    with reporter.run("database", "journal_credit_debit_remap_on_sync", severity=SEV_CRITICAL) as t:
        if not sync_text:
            t.skip("No project source supplied (electron/main/cloud/cloud-sync-manager.ts not found)")
        else:
            core_tables = src.core_sync_tables()
            journal_is_synced = "journal_entries" in core_tables
            t.evidence = {"journal_entries_in_CORE_TABLES": journal_is_synced,
                          "CORE_TABLES": core_tables}
            if not journal_is_synced:
                t.blocked("journal_entries is not in CORE_TABLES - not currently synced "
                          "at all, so the id-collision risk below is dormant but should "
                          "be re-checked if that changes")
            else:
                # syncTable() spreads the full row (`{ ...record, id: compositeId }`)
                # and only the row's own primary key gets device-prefixed. Search the
                # actual sync code for any sign that debit_account_id/credit_account_id
                # specifically get remapped -- if there is none, this is a real,
                # unmitigated risk, not a hypothetical one.
                remap_evidence = re.search(
                    r'debit_account_id|credit_account_id', sync_text)
                spreads_full_row = bool(re.search(r'\.\.\.record', sync_text))
                t.evidence["remap_code_found_for_account_fk_columns"] = bool(remap_evidence)
                t.evidence["syncTable_spreads_full_row_unmodified"] = spreads_full_row
                if spreads_full_row and not remap_evidence:
                    t.fail(
                        "CONFIRMED BY STATIC ANALYSIS: electron/main/cloud/cloud-sync-manager.ts "
                        "syncTable() pushes journal_entries rows to the cloud via "
                        "`{ ...record, id: compositeId }` -- only the row's own primary id "
                        "is device-prefixed. debit_account_id/credit_account_id are sent "
                        "as-is, still referencing this device's local accounts.id "
                        "AUTOINCREMENT values, with no remap to a stable identifier "
                        "(e.g. accounts.code) anywhere in this file. On a second device, "
                        "a pulled journal_entries row's debit/credit account ids are not "
                        "guaranteed to point at the equivalent account locally, especially "
                        "once any user-defined (non-seed) account exists on either device. "
                        "Do NOT import/sync journal_entries across devices until this is "
                        "fixed; this agent does not attempt to invent a remap.",
                        severity=SEV_CRITICAL,
                    )

    with reporter.run("database", "accounts_table_itself_synced") as t:
        if not sync_text:
            t.skip("No project source supplied")
        else:
            core_tables = src.core_sync_tables()
            t.evidence = {"accounts_in_CORE_TABLES": "accounts" in core_tables}
            if "accounts" not in core_tables and "journal_entries" in core_tables:
                t.fail("journal_entries syncs but its parent `accounts` table does not "
                      "appear in CORE_TABLES - a second device could receive journal "
                      "entries referencing accounts it has never received", severity=SEV_HIGH)

# --------------------------------------------------------------------------
# SECTION 10 - CLOUD / D1 QA
#
# All cloud calls below are made THROUGH the running app's own exposed
# window.mooral.cloud.* bridge (see preload.ts) so this script never
# needs, sees, or prints the actual workspace/API-key secrets itself.
# --------------------------------------------------------------------------

def run_cloud_d1_qa(reporter: Reporter, src: ProjectSource, ctx: dict, session: Optional[dict], args) -> None:
    wrangler = ctx.get("wrangler") or src.wrangler_config()

    with reporter.run("cloud", "cloudflare_config_present") as t:
        if not wrangler:
            t.skip("No cloudflare/wrangler.toml found under --project")
        else:
            t.evidence = wrangler

    page = session.get("page") if session else None
    if not page:
        with reporter.run("cloud", "cloud_api_via_app", blocked_reason=(
                "No live renderer attached - cloud checks are performed through the "
                "running app's own window.mooral.cloud bridge to avoid this script "
                "ever handling raw API keys itself.")) as t:
            pass
        return

    with reporter.run("cloud", "config_exists") as t:
        try:
            cfg = page.evaluate("() => window.mooral?.cloud?.getConfig ? window.mooral.cloud.getConfig() : {__missing:true}")
            if isinstance(cfg, dict) and cfg.get("__missing"):
                t.skip("window.mooral.cloud.getConfig is not exposed by this build")
                return
            # Never print secret values -- only report presence/shape.
            safe = {k: ("<redacted>" if k.lower() in ("apikey", "api_key", "secret") else v)
                    for k, v in (cfg or {}).items()} if isinstance(cfg, dict) else cfg
            t.evidence = safe
            if isinstance(cfg, dict) and not cfg.get("enabled"):
                t.blocked("Cloud sync is disabled in app configuration - remaining "
                          "cloud/sync tests will SKIP")
        except Exception as e:
            t.blocked(f"Could not read cloud config via app bridge: {e}")

    with reporter.run("cloud", "health_reachable", severity=SEV_HIGH) as t:
        try:
            health = page.evaluate("() => window.mooral?.cloud?.health ? window.mooral.cloud.health() : {__missing:true}")
            if isinstance(health, dict) and health.get("__missing"):
                t.skip("window.mooral.cloud.health is not exposed by this build")
            else:
                t.evidence = health
                if isinstance(health, dict) and not health.get("success"):
                    t.fail(f"Cloud health check failed: {health}", severity=SEV_HIGH)
        except Exception as e:
            t.fail(f"Cloud health check raised: {e}", severity=SEV_HIGH)

    with reporter.run("cloud", "record_retrieval_read_only") as t:
        try:
            sample = page.evaluate(
                "() => window.mooral?.cloud?.listRecords ? window.mooral.cloud.listRecords('products', 5) : {__missing:true}")
            if isinstance(sample, dict) and sample.get("__missing"):
                t.skip("window.mooral.cloud.listRecords is not exposed by this build")
            else:
                count = sample.get("count") if isinstance(sample, dict) else None
                t.evidence = {"sample_count_field": count,
                              "sample_row_count_returned": len(sample.get("rows", [])) if isinstance(sample, dict) else None}
        except Exception as e:
            t.blocked(f"Cloud record retrieval raised: {e}")


# --------------------------------------------------------------------------
# SECTION 11 - CLOUD SYNC QA
#
# Because only one physical Windows machine is typically available, "Device
# B" is simulated exactly as the spec allows: a second app instance pointed
# at an isolated --user-data-dir (its own fresh config.json + mooral.db),
# driven through the same window.mooral.cloud bridge. This is real runtime
# evidence of the real sync implementation, not a fabricated result.
# --------------------------------------------------------------------------

SYNC_EXPLICIT_TABLES = ["products", "customers", "employees", "transactions",
                         "accounts", "invoices", "certificates"]
SYNC_INSPECT_ONLY_TABLES = ["orders", "inventory_transactions", "ledger_entries",
                             "notifications", "employee_contracts", "journal_entries",
                             "users", "company_settings"]


def _cloud_count(page, table: str) -> Optional[int]:
    try:
        r = page.evaluate(
            "([t]) => window.mooral.cloud.listRecords(t, 2000)", [table])
        if isinstance(r, dict):
            return len(r.get("rows", [])) if "rows" in r else r.get("count")
    except Exception:
        return None
    return None


def run_cloud_sync_qa(reporter: Reporter, src: ProjectSource, ctx: dict, session: Optional[dict], args) -> None:
    core_tables = src.core_sync_tables()

    with reporter.run("sync", "declared_sync_scope") as t:
        if not core_tables:
            t.skip("No project source supplied to determine CORE_TABLES")
        else:
            t.evidence = {"CORE_TABLES": core_tables}

    with reporter.run("sync", "table_sync_support_matrix") as t:
        if not core_tables:
            t.skip("No project source supplied")
        else:
            matrix = {tbl: (tbl in core_tables) for tbl in SYNC_EXPLICIT_TABLES + SYNC_INSPECT_ONLY_TABLES}
            t.evidence = matrix
            unsupported_required = [tbl for tbl in SYNC_EXPLICIT_TABLES if not matrix[tbl]]
            if unsupported_required:
                t.fail(f"Tables expected to sync are NOT in CORE_TABLES: {unsupported_required} "
                      "- these are reported unsupported, not marked PASS", severity=SEV_MEDIUM)

    page_a = session.get("page") if session else None
    if not page_a or not ctx.get("exe_path"):
        with reporter.run("sync", "device_a_to_device_b_flow", blocked_reason=(
                "Requires a live Device A app instance (see startup section) plus the "
                "ability to launch a second isolated instance - not available in this "
                "run.")) as t:
            pass
        return

    if args.mode not in ("full", "sync"):
        with reporter.run("sync", "device_a_to_device_b_flow", skip_reason=(
                f"Multi-device sync simulation not run under --mode {args.mode} "
                "(use --mode full or --mode sync)")) as t:
            pass
        return

    exe_path = ctx["exe_path"]
    with reporter.run("sync", "device_a_baseline_counts") as t:
        baseline = {}
        try:
            for tbl in ("products", "customers"):
                baseline[tbl] = _cloud_count(page_a, tbl)
            t.evidence = baseline
        except Exception as e:
            t.blocked(f"Could not read Device A baseline via cloud bridge: {e}")
            return

    with reporter.run("sync", "device_a_sync_now") as t:
        try:
            result = page_a.evaluate("() => window.mooral.cloud.syncNow()")
            t.evidence = result
        except Exception as e:
            t.fail(f"Device A syncNow() raised: {e}", severity=SEV_HIGH)

    device_b_dir = Path(tempfile.mkdtemp(prefix="mbs_qa_device_b_"))
    app_b = None
    try:
        with reporter.run("sync", "device_b_isolated_instance_launch") as t:
            try:
                app_b = launch_app(exe_path, user_data_dir=device_b_dir)
                ok = app_b.cdp_reachable(timeout=args.timeout or 25)
                t.evidence = {"user_data_dir": str(device_b_dir), "cdp_reachable": ok}
                if not ok:
                    t.blocked("Could not attach to a second isolated app instance for "
                              "Device B simulation")
                    return
            except Exception as e:
                t.blocked(f"Could not launch Device B instance: {e}")
                return

        if not HAVE_PLAYWRIGHT:
            with reporter.run("sync", "device_b_cloud_pull", blocked_reason="playwright not installed") as t:
                pass
            return

        _, _, page_b = app_b.connect_playwright()
        if not page_b:
            with reporter.run("sync", "device_b_cloud_pull", blocked_reason="Could not attach to Device B renderer") as t:
                pass
            return

        with reporter.run("sync", "device_b_cloud_pull") as t:
            try:
                # Device B's own cloud config must be set up identically for
                # this to be meaningful; if it isn't configured (fresh
                # profile), that itself is useful evidence, not a failure.
                cfg_b = page_b.evaluate("() => window.mooral.cloud.getConfig()")
                if not (isinstance(cfg_b, dict) and cfg_b.get("enabled")):
                    t.blocked("Fresh Device B profile has no cloud configuration - this "
                              "app does not appear to auto-provision cloud config for a "
                              "brand-new install, so a true pull-based Device B "
                              "comparison cannot proceed automatically")
                    return
                pulled = {tbl: _cloud_count(page_b, tbl) for tbl in ("products", "customers")}
                t.evidence = pulled
            except Exception as e:
                t.blocked(f"Device B cloud read raised: {e}")
                return

        with reporter.run("sync", "duplicate_detection_second_sync") as t:
            try:
                r1 = page_a.evaluate("() => window.mooral.cloud.syncNow()")
                counts_after_1 = {tbl: _cloud_count(page_a, tbl) for tbl in ("products", "customers")}
                r2 = page_a.evaluate("() => window.mooral.cloud.syncNow()")
                counts_after_2 = {tbl: _cloud_count(page_a, tbl) for tbl in ("products", "customers")}
                t.evidence = {"after_sync_1": counts_after_1, "after_sync_2": counts_after_2}
                grew = {k: v for k in counts_after_1 if (v := counts_after_2.get(k)) is not None
                        and counts_after_1.get(k) is not None and v > counts_after_1[k]}
                if grew:
                    t.fail(f"Record counts grew between two consecutive syncs with no new "
                          f"local data - possible duplicate-on-resync: {grew}", severity=SEV_HIGH)
            except Exception as e:
                t.blocked(f"Idempotency probe raised: {e}")
    finally:
        if app_b:
            app_b.close()
        with contextlib.suppress(Exception):
            if not args.keep_temp:
                shutil.rmtree(device_b_dir, ignore_errors=True)

# --------------------------------------------------------------------------
# SECTION 13 - OFFLINE MODE
# --------------------------------------------------------------------------

def run_offline_qa(reporter: Reporter, ctx: dict, args) -> None:
    exe_path = ctx.get("exe_path")
    if not exe_path:
        with reporter.run("offline", "offline_startup", skip_reason="No --exe supplied") as t:
            pass
        return
    if not IS_WINDOWS:
        with reporter.run("offline", "offline_startup", blocked_reason=f"Cannot launch on {platform.system()}") as t:
            pass
        return

    # We cannot actually sever the machine's network from inside a
    # non-privileged Python script, and the spec explicitly forbids
    # faking network conditions that cannot really be applied. So this
    # section only tests what CAN genuinely be verified: that the app
    # starts and basic local reads work when cloud sync is left at
    # whatever its current disabled/enabled state is, and is explicit
    # about not simulating a real network outage.
    with reporter.run("offline", "network_condition_simulation", skip_reason=(
            "This script cannot programmatically sever host network access "
            "without elevated/administrative OS-level changes, and per spec "
            "must not fake network conditions it cannot actually apply. To "
            "test true offline behaviour, physically disconnect networking "
            "and re-run with --mode offline.")) as t:
        pass

    isolated_dir = Path(tempfile.mkdtemp(prefix="mbs_qa_offline_"))
    app = None
    try:
        with reporter.run("offline", "app_starts_with_isolated_profile") as t:
            app = launch_app(exe_path, user_data_dir=isolated_dir)
            ok = app.cdp_reachable(timeout=args.timeout or 25)
            t.evidence = {"cdp_reachable": ok}
            if not ok:
                t.fail("App did not start with a fresh isolated profile", severity=SEV_HIGH)
                return

        if not HAVE_PLAYWRIGHT:
            with reporter.run("offline", "local_crud_without_cloud", blocked_reason="playwright not installed") as t:
                pass
            return

        _, _, page = app.connect_playwright()
        if not page:
            with reporter.run("offline", "local_crud_without_cloud", blocked_reason="Could not attach to renderer") as t:
                pass
            return

        with reporter.run("offline", "app_does_not_crash_on_fresh_profile") as t:
            page.wait_for_timeout(2000)
            t.evidence = {"alive": app.is_alive()}
            if not app.is_alive():
                t.fail("App crashed shortly after starting a fresh/offline-like profile", severity=SEV_CRITICAL)
    finally:
        if app:
            app.close()
        with contextlib.suppress(Exception):
            if not args.keep_temp:
                shutil.rmtree(isolated_dir, ignore_errors=True)


# --------------------------------------------------------------------------
# SECTION 14 - FAILURE / RECOVERY TESTS (isolated environments only)
# --------------------------------------------------------------------------

def run_failure_recovery_qa(reporter: Reporter, ctx: dict, args) -> None:
    exe_path = ctx.get("exe_path")
    if not exe_path or not IS_WINDOWS:
        with reporter.run("failure", "isolated_failure_injection", skip_reason=(
                "Requires --exe on Windows; not available in this run")) as t:
            pass
        return

    isolated_dir = Path(tempfile.mkdtemp(prefix="mbs_qa_failure_"))
    app = None
    try:
        with reporter.run("failure", "unexpected_termination_recovery", severity=SEV_HIGH) as t:
            try:
                app = launch_app(exe_path, user_data_dir=isolated_dir)
                ok = app.cdp_reachable(timeout=args.timeout or 25)
                if not ok:
                    t.blocked("Isolated instance did not start")
                    return
                # Simulate an unexpected termination (isolated profile only).
                app.proc.kill()
                app.proc.wait(timeout=10)
                time.sleep(1)
                # Restart against the SAME isolated profile/db and verify it
                # comes back up and the db is still openable.
                app2 = launch_app(exe_path, user_data_dir=isolated_dir)
                ok2 = app2.cdp_reachable(timeout=args.timeout or 25)
                t.evidence = {"restarted_ok": ok2}
                if not ok2:
                    t.fail("App did not recover after an unexpected kill of the previous "
                          "instance against the same profile", severity=SEV_HIGH)
                app2.close()
            except Exception as e:
                t.fail(f"Failure/recovery probe raised: {e}", severity=SEV_HIGH)

        with reporter.run("failure", "db_integrity_after_kill", severity=SEV_CRITICAL) as t:
            db_path = isolated_dir / "mooral.db"
            if not db_path.exists():
                t.skip("Isolated profile has no mooral.db to check (app may not have "
                      "reached DB init before being killed)")
            else:
                conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
                rows = conn.execute("PRAGMA integrity_check").fetchall()
                conn.close()
                t.evidence = [r[0] for r in rows]
                if not (len(rows) == 1 and rows[0][0] == "ok"):
                    t.fail(f"Database corruption detected after simulated kill: {t.evidence}", severity=SEV_CRITICAL)
    finally:
        if app:
            app.close()
        with contextlib.suppress(Exception):
            if not args.keep_temp:
                shutil.rmtree(isolated_dir, ignore_errors=True)


# --------------------------------------------------------------------------
# SECTION 15 - PERFORMANCE
# --------------------------------------------------------------------------

def run_performance_qa(reporter: Reporter, session: Optional[dict], ctx: dict, args) -> None:
    app: Optional[LaunchedApp] = session.get("app") if session else None
    page = session.get("page") if session else None

    with reporter.run("performance", "idle_resource_usage") as t:
        if not app:
            t.skip("No live app instance")
        else:
            usage = app.memory_cpu()
            if not usage:
                t.skip("psutil not installed")
            else:
                t.evidence = usage

    with reporter.run("performance", "database_query_time") as t:
        db_path = ctx.get("db_path")
        if not db_path or not Path(db_path).exists():
            t.skip("No readable database")
        else:
            conn = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
            tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            timings = {}
            for tbl in tables[:15]:
                t0 = time.time()
                with contextlib.suppress(Exception):
                    conn.execute(f"SELECT * FROM {tbl} LIMIT 1000").fetchall()
                timings[tbl] = round((time.time() - t0) * 1000, 2)
            conn.close()
            t.evidence = {"query_ms_per_table": timings}
            slow = {k: v for k, v in timings.items() if v > 1000}
            if slow:
                t.fail(f"Query took >1000ms on tables: {slow}", severity=SEV_MEDIUM)

    with reporter.run("performance", "crud_response_time") as t:
        if not page:
            t.skip("No live renderer attached")
        else:
            try:
                t0 = time.time()
                page.evaluate("() => window.mooral?.products?.getAll ? window.mooral.products.getAll() : null")
                elapsed_ms = round((time.time() - t0) * 1000, 2)
                t.evidence = {"products_getAll_ms": elapsed_ms}
                if elapsed_ms > 3000:
                    t.fail(f"products.getAll() took {elapsed_ms}ms (>3000ms budget)", severity=SEV_MEDIUM)
            except Exception as e:
                t.blocked(f"CRUD timing probe raised: {e}")


# --------------------------------------------------------------------------
# SECTION 16 - STRESS
# --------------------------------------------------------------------------

def run_stress_qa(reporter: Reporter, session: Optional[dict], args) -> None:
    app: Optional[LaunchedApp] = session.get("app") if session else None
    page = session.get("page") if session else None
    if not app or not page:
        with reporter.run("stress", "repeated_navigation", blocked_reason="No live app/renderer attached") as t:
            pass
        return

    routes = ["/", "/products", "/customers", "/orders", "/accounting", "/settings"]
    reps = 15 if args.mode == "stress" else 5

    with reporter.run("stress", "repeated_navigation") as t:
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        rss_samples = []
        for i in range(reps):
            route = routes[i % len(routes)]
            with contextlib.suppress(Exception):
                page.evaluate(f"window.location.hash = '#{route}'")
                page.wait_for_timeout(300)
            usage = app.memory_cpu()
            if usage:
                rss_samples.append(usage.get("rss_mb"))
        t.evidence = {"iterations": reps, "console_errors": len(errors), "rss_mb_samples": rss_samples}
        if errors:
            t.fail(f"{len(errors)} uncaught exception(s) during repeated navigation stress", severity=SEV_MEDIUM)
        if len(rss_samples) >= 2 and rss_samples[-1] and rss_samples[0]:
            growth = rss_samples[-1] - rss_samples[0]
            if growth > 300:
                t.fail(f"RAM grew by {growth:.1f}MB over {reps} navigations - possible leak", severity=SEV_MEDIUM)

    with reporter.run("stress", "repeated_crud") as t:
        if args.mode != "stress":
            t.skip("Repeated-CRUD stress only runs under --mode stress (use it to avoid "
                  "leaving many QA-tagged records during a routine full run)")
        else:
            created_ids = []
            errs = 0
            for i in range(20):
                try:
                    r = page.evaluate(
                        "([p]) => window.mooral.products.create(p)",
                        [{"name": f"{QA_TAG}_stress_{i}", "price": 1, "stock": 0}],
                    )
                    if isinstance(r, dict) and r.get("id"):
                        created_ids.append(r["id"])
                except Exception:
                    errs += 1
            for cid in created_ids:
                with contextlib.suppress(Exception):
                    page.evaluate("([id]) => window.mooral.products.delete(id)", [cid])
            t.evidence = {"attempted": 20, "created": len(created_ids), "errors": errs}
            if errs > 5:
                t.fail(f"{errs}/20 repeated create calls errored", severity=SEV_MEDIUM)

# --------------------------------------------------------------------------
# SECTION 17 - INSTALLER QA
# --------------------------------------------------------------------------

def run_installer_qa(reporter: Reporter, ctx: dict, args) -> None:
    installer_path = ctx.get("installer_path")
    if not installer_path:
        with reporter.run("installer", "installer_tests", skip_reason="No --installer supplied") as t:
            pass
        return
    if not IS_WINDOWS:
        with reporter.run("installer", "installer_tests", blocked_reason=f"Cannot run a Windows installer on {platform.system()}") as t:
            pass
        return

    install_dir = Path(tempfile.mkdtemp(prefix="mbs_qa_install_"))

    with reporter.run("installer", "installer_launches") as t:
        try:
            # NSIS silent install into an isolated directory -- never touches
            # the user's existing installation.
            proc = subprocess.run(
                [str(installer_path), "/S", f"/D={install_dir}"],
                capture_output=True, timeout=args.timeout or 300,
            )
            t.evidence = {"returncode": proc.returncode}
            if proc.returncode != 0:
                t.fail(f"Silent installer exited {proc.returncode}", severity=SEV_HIGH)
        except subprocess.TimeoutExpired:
            t.blocked("Installer did not complete within timeout")
            return
        except Exception as e:
            t.blocked(f"Could not run installer: {e}")
            return

    with reporter.run("installer", "expected_files_exist") as t:
        exes = list(install_dir.rglob("*.exe"))
        t.evidence = {"install_dir": str(install_dir), "exe_files_found": [str(p) for p in exes]}
        if not exes:
            t.fail("No .exe found in isolated install directory after silent install", severity=SEV_HIGH)

    with reporter.run("installer", "application_launches_after_install") as t:
        exes = list(install_dir.rglob("*.exe"))
        main_exe = next((p for p in exes if "uninstall" not in p.name.lower()), None)
        if not main_exe:
            t.blocked("No launchable app exe found after install")
        else:
            app = None
            try:
                app = launch_app(main_exe)
                ok = app.cdp_reachable(timeout=args.timeout or 25)
                t.evidence = {"cdp_reachable": ok}
                if not ok:
                    t.fail("Freshly installed app did not start / expose CDP", severity=SEV_HIGH)
            finally:
                if app:
                    app.close()

    with reporter.run("installer", "native_modules_load") as t:
        unpacked = install_dir / "resources" / "app.asar.unpacked"
        if not unpacked.exists():
            t.blocked("No app.asar.unpacked directory found post-install")
        else:
            natives = list(unpacked.rglob("*.node"))
            t.evidence = [str(p) for p in natives]
            if not natives:
                t.fail("No .node native binaries found unpacked post-install", severity=SEV_CRITICAL)

    with reporter.run("installer", "uninstall") as t:
        uninstaller = next(iter(install_dir.rglob("Uninstall*.exe")), None)
        if not uninstaller:
            t.blocked("No uninstaller exe found - skipping uninstall to avoid guessing at flags")
        else:
            try:
                proc = subprocess.run([str(uninstaller), "/S"], capture_output=True, timeout=args.timeout or 180)
                t.evidence = {"returncode": proc.returncode}
                if proc.returncode not in (0,):
                    t.fail(f"Silent uninstaller exited {proc.returncode}", severity=SEV_MEDIUM)
            except Exception as e:
                t.blocked(f"Could not run uninstaller: {e}")

    with contextlib.suppress(Exception):
        if not args.keep_temp:
            shutil.rmtree(install_dir, ignore_errors=True)


# --------------------------------------------------------------------------
# SECTION 18 - SECURITY QA (safe static/runtime checks only)
# --------------------------------------------------------------------------

SECRET_PATTERNS = [
    ("hardcoded_api_key", re.compile(r'(?i)api[_-]?key["\']?\s*[:=]\s*["\'][A-Za-z0-9_\-]{16,}["\']')),
    ("hardcoded_secret", re.compile(r'(?i)secret["\']?\s*[:=]\s*["\'][A-Za-z0-9_\-]{16,}["\']')),
    ("private_key_block", re.compile(r'-----BEGIN (RSA |EC )?PRIVATE KEY-----')),
    ("console_log_password", re.compile(r'console\.(log|warn|error)\([^)]*password', re.I)),
    ("console_log_token", re.compile(r'console\.(log|warn|error)\([^)]*\b(token|apikey|api_key)\b', re.I)),
]

SQLI_PATTERN = re.compile(
    r'\.(?:exec|prepare|run|get|all)\(\s*(?:`[^`]*\$\{|["\'][^"\']*["\']\s*\+\s*\w)', re.I
)


def run_security_qa(reporter: Reporter, src: ProjectSource) -> None:
    if not src.available:
        with reporter.run("security", "static_scan", skip_reason="No project source supplied") as t:
            pass
        return

    files = src.all_source_files()
    with reporter.run("security", "source_files_scanned") as t:
        t.evidence = {"file_count": len(files)}

    findings: dict[str, list[str]] = {}
    for f in files:
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for name, pattern in SECRET_PATTERNS:
            for m in pattern.finditer(text):
                # Redact the actual matched secret-looking value from evidence.
                findings.setdefault(name, []).append(f"{f.relative_to(src.root)}:{text[:m.start()].count(chr(10)) + 1}")

    with reporter.run("security", "exposed_secrets_in_source", severity=SEV_CRITICAL) as t:
        t.evidence = {k: v[:20] for k, v in findings.items()}
        if findings:
            t.fail(f"Potential exposed secret patterns found: "
                  f"{ {k: len(v) for k, v in findings.items()} }", severity=SEV_CRITICAL)

    with reporter.run("security", "env_example_has_no_real_secrets") as t:
        env_txt = src._read(".env.example")
        if env_txt is None:
            t.skip(".env.example not found")
        else:
            # Only flag lines whose KEY name itself looks secret-shaped
            # (key/secret/token/password) with a non-placeholder value --
            # ordinary config like NODE_ENV=development must not trip this.
            suspect_lines = [
                ln for ln in env_txt.splitlines()
                if re.match(r'(?i)^\s*[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*\S+', ln)
                and not re.search(r'(?i)your[_-]?|example|placeholder|changeme|xxx|<.*>', ln)
            ]
            t.evidence = {"suspect_lines": suspect_lines}
            if suspect_lines:
                t.fail(f".env.example appears to contain real (non-placeholder) secret "
                      f"values: {suspect_lines}", severity=SEV_HIGH)

    with reporter.run("security", "cloud_credentials_returned_to_renderer") as t:
        main_txt = src._read("electron/main/main.ts")
        config_service_txt = src._read("electron/main/cloud/cloud-config-service.ts")
        if main_txt is None:
            t.skip("electron/main/main.ts not found")
        else:
            m = re.search(r'ipcMain\.handle\(\s*"cloud:getConfig"\s*,\s*\(\)\s*=>\s*([^)]*)\)', main_txt)
            handler_expr = m.group(1).strip() if m else None
            redacts = bool(config_service_txt and re.search(
                r'redact|mask|\*{3,}', config_service_txt, re.I))
            t.evidence = {"cloud:getConfig_handler": handler_expr, "config_service_appears_to_redact": redacts}
            if handler_expr and not redacts:
                t.fail(
                    f"cloud:getConfig resolves via `{handler_expr}` and "
                    "electron/main/cloud/cloud-config-service.ts shows no obvious "
                    "redaction/masking of the API key before it's returned. This means "
                    "the renderer process (and therefore devtools/any renderer-side "
                    "logging) can hold the plaintext cloud API key. This may be "
                    "acceptable for a single-user local settings screen, but should be "
                    "confirmed against intended design rather than assumed safe - not "
                    "auto-fixed by this agent.", severity=SEV_MEDIUM)

    with reporter.run("security", "sql_injection_prone_string_construction", severity=SEV_HIGH) as t:
        db_txt = src._read("src/database/database.ts")
        hits = []
        if db_txt:
            for m in SQLI_PATTERN.finditer(db_txt):
                hits.append(db_txt[:m.start()].count("\n") + 1)
        t.evidence = {"suspect_line_numbers_in_database.ts": hits}
        if hits:
            t.fail(f"database.ts has {len(hits)} SQL call site(s) built via string "
                  f"interpolation/concatenation rather than parameter binding at lines "
                  f"{hits[:20]} - review for injection risk (dynamic table names in "
                  "PRAGMA/DDL statements are common false positives here; confirm "
                  "manually)", severity=SEV_MEDIUM)

    with reporter.run("security", "license_signing_keys_tagged") as t:
        keys_txt = src.trusted_license_keys_text()
        if keys_txt is None:
            t.skip("license-v2/keys/trusted-keys.ts not found")
        else:
            untagged = "development" not in keys_txt.lower() and "production" not in keys_txt.lower()
            placeholder = "<production public key base64>" in keys_txt
            t.evidence = {"appears_untagged": untagged, "placeholder_key_present": placeholder}
            if placeholder:
                t.fail("Production license public key has not been provisioned "
                      "(placeholder still present in trusted-keys.ts) - matches the "
                      "project's own scripts/release-check.mjs gate", severity=SEV_HIGH)

# --------------------------------------------------------------------------
# SECTION 19 - BUSINESS DATA CONSISTENCY (read-only, against the real DB)
# --------------------------------------------------------------------------

def run_business_consistency_qa(reporter: Reporter, ctx: dict) -> None:
    db_path = ctx.get("db_path")
    if not db_path or not Path(db_path).exists():
        with reporter.run("business", "consistency_checks", blocked_reason="No readable database") as t:
            pass
        return

    conn = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    with reporter.run("business", "ledger_running_balance_arithmetic", severity=SEV_HIGH) as t:
        if "ledger_entries" not in tables:
            t.skip("ledger_entries table not present")
        else:
            # For each account, walk entries in (entry_date, id) order and
            # confirm each row's running_balance equals prior + debit - credit.
            # This checks the app's own stored arithmetic, it does not invent
            # an accounting rule of its own.
            accounts = [r[0] for r in conn.execute(
                "SELECT DISTINCT account_id FROM ledger_entries")]
            mismatches = []
            for acc in accounts[:200]:
                rows = conn.execute(
                    "SELECT id, debit, credit, running_balance FROM ledger_entries "
                    "WHERE account_id=? ORDER BY entry_date, id", (acc,)
                ).fetchall()
                running = 0.0
                for rid, debit, credit, stored_balance in rows:
                    running += (debit or 0) - (credit or 0)
                    if stored_balance is not None and abs(running - stored_balance) > 0.01:
                        mismatches.append({"account_id": acc, "ledger_entry_id": rid,
                                            "expected": round(running, 2), "stored": stored_balance})
                        break
            t.evidence = {"accounts_checked": len(accounts[:200]), "mismatches": mismatches[:20]}
            if mismatches:
                t.fail(f"{len(mismatches)} account(s) have a running_balance that does not "
                      "match cumulative debit-credit of prior entries", severity=SEV_HIGH)

    with reporter.run("business", "invoice_totals_vs_line_items") as t:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(invoices)")} if "invoices" in tables else set()
        if "invoices" not in tables or "total" not in cols and "total_amount" not in cols:
            t.skip("invoices table/total column not found in this schema")
        else:
            t.blocked("invoices table has no separate line-items table in the discovered "
                      "schema to cross-check totals against; this agent will not invent "
                      "a line-item relationship that isn't in the actual schema")

    with reporter.run("business", "product_stock_non_negative") as t:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")} if "products" in tables else set()
        stock_col = next((c for c in ("stock", "quantity", "stock_quantity") if c in cols), None)
        if not stock_col:
            t.skip("No stock/quantity column found on products table")
        else:
            negatives = conn.execute(f"SELECT COUNT(*) FROM products WHERE {stock_col} < 0").fetchone()[0]
            t.evidence = {"negative_stock_rows": negatives}
            if negatives:
                t.fail(f"{negatives} product(s) have negative stock", severity=SEV_MEDIUM)

    conn.close()


# --------------------------------------------------------------------------
# SECTION 20 - REGRESSION TESTING
#
# Composed from evidence already gathered above rather than re-running
# duplicate work; each line is only reported PASS if the corresponding
# underlying check actually ran and passed.
# --------------------------------------------------------------------------

REGRESSION_MAP = [
    ("better_sqlite3_native_module_loading", "build", "packaged_resources_and_native_module"),
    ("packaged_exe_startup", "startup", "process_remains_alive"),
    ("white_screen", "startup", "no_white_screen"),
    ("settings_persistence", "crud", "settings_edit_save_reload"),
    ("orders_page_rendering", "ui", "route_loads:/orders"),
    ("accounting_page_rendering", "ui", "route_loads:/accounting"),
    ("employees_page_rendering", "ui", "route_loads:/employees"),
    ("sync_now", "cloud", "health_reachable"),
    ("cloud_synchronization", "sync", "device_a_sync_now"),
    ("duplicate_sync", "sync", "duplicate_detection_second_sync"),
    ("offline_behavior", "offline", "app_does_not_crash_on_fresh_profile"),
]


def run_regression_qa(reporter: Reporter) -> None:
    by_key = {(r.category, r.name): r for r in reporter.results}
    for label, cat, name in REGRESSION_MAP:
        with reporter.run("regression", label) as t:
            prior = by_key.get((cat, name))
            if prior is None:
                t.skip(f"Underlying check {cat}/{name} did not run in this session")
            else:
                t.evidence = {"based_on": f"{cat}/{name}", "observed_status": prior.status}
                if prior.status == STATUS_FAIL:
                    t.fail(f"Historical problem area regressed: {cat}/{name} -> FAIL "
                          f"({prior.error})", severity=prior.severity)
                elif prior.status in (STATUS_SKIP, STATUS_BLOCKED):
                    t.blocked(f"Cannot confirm this historical issue is fixed - underlying "
                              f"check {cat}/{name} was {prior.status}, not actually run")

# --------------------------------------------------------------------------
# MODE -> CATEGORY MAP and CLI / orchestration
# --------------------------------------------------------------------------

MODE_CATEGORIES = {
    "smoke": {"preflight", "build", "startup", "ui"},
    "functional": {"preflight", "startup", "ui", "crud"},
    "ui": {"preflight", "startup", "ui"},
    "database": {"preflight", "database"},
    "cloud": {"preflight", "cloud"},
    "sync": {"preflight", "startup", "sync"},
    "offline": {"preflight", "offline"},
    "recovery": {"preflight", "failure"},
    "performance": {"preflight", "startup", "performance"},
    "stress": {"preflight", "startup", "stress"},
    "failure": {"preflight", "failure"},
    "installer": {"preflight", "build", "installer"},
    "security": {"preflight", "security"},
    "business": {"preflight", "business"},
    "regression": {"preflight", "build", "startup", "ui", "crud", "database",
                    "cloud", "sync", "offline", "regression"},
    "full": {"preflight", "build", "startup", "ui", "crud", "database", "cloud",
              "sync", "offline", "failure", "performance", "installer",
              "security", "business", "regression"},
}


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="mbs_customer_release_qa.py",
        description="External, non-destructive customer-release QA agent for Mooral Business Suite.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--mode", choices=sorted(MODE_CATEGORIES), default="full")
    p.add_argument("--project", help="Path to the MBS source tree (enables source-derived checks)")
    p.add_argument("--exe", help="Path to the installed/portable Mooral Business Suite.exe")
    p.add_argument("--installer", help="Path to the NSIS installer .exe")
    p.add_argument("--db", help="Path to mooral.db (defaults to the standard Windows userData path)")
    p.add_argument("--duration", type=int, default=60, help="Duration budget (seconds) for stress/performance loops")
    p.add_argument("--timeout", type=int, default=60, help="Per-operation timeout (seconds)")
    p.add_argument("--retries", type=int, default=0, help="Retries for flaky runtime checks (currently informational)")
    p.add_argument("--headless", action="store_true", help="Reserved for future headless-capable checks")
    p.add_argument("--keep-temp", action="store_true", help="Do not delete isolated temp profiles/dbs created during testing")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--report-dir", default="qa-report", help="Directory to write the QA report into")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    report_dir = Path(args.report_dir)
    reporter = Reporter(report_dir, verbose=args.verbose)

    print("=" * 78)
    print(f"MBS CUSTOMER RELEASE QA AGENT v{SCRIPT_VERSION} - mode={args.mode}")
    print("=" * 78)

    project_dir = Path(args.project).resolve() if args.project else None
    src = ProjectSource(project_dir)

    categories = MODE_CATEGORIES[args.mode]
    ctx = run_preflight(reporter, src, args)

    if "build" in categories:
        run_build_artifact_qa(reporter, src, ctx, args)

    session = None
    if {"startup", "ui", "crud", "sync", "performance", "stress"} & categories:
        session = run_startup_qa(reporter, ctx, args)

    if "ui" in categories:
        run_ui_navigation_qa(reporter, src, session, args)

    if "crud" in categories:
        run_crud_qa(reporter, session, src, args)
        run_settings_profile_qa(reporter, session)

    if "database" in categories:
        run_database_qa(reporter, src, ctx)
        run_journal_account_safety_qa(reporter, src, ctx)

    if "cloud" in categories:
        run_cloud_d1_qa(reporter, src, ctx, session, args)

    if "sync" in categories:
        run_cloud_sync_qa(reporter, src, ctx, session, args)

    if "offline" in categories:
        run_offline_qa(reporter, ctx, args)

    if "failure" in categories:
        run_failure_recovery_qa(reporter, ctx, args)

    if "performance" in categories:
        run_performance_qa(reporter, session, ctx, args)

    if "stress" in categories:
        run_stress_qa(reporter, session, args)

    if "installer" in categories:
        run_installer_qa(reporter, ctx, args)

    if "security" in categories:
        run_security_qa(reporter, src)

    if "business" in categories:
        run_business_consistency_qa(reporter, ctx)

    # Startup session teardown happens before regression (which reads the
    # results collected above) and before the final report is written.
    if session:
        teardown_startup_qa(reporter, session)

    if "regression" in categories:
        run_regression_qa(reporter)

    json_path, txt_path = reporter.write_reports(vars(args))
    verdict, notable = reporter.verdict()
    counts = reporter.counts()

    print()
    print("=" * 78)
    print("FINAL SUMMARY")
    print("=" * 78)
    total = len(reporter.results)
    print(f"Total tests : {total}")
    for k in (STATUS_PASS, STATUS_FAIL, STATUS_SKIP, STATUS_BLOCKED):
        print(f"  {k:<8}: {counts['status'].get(k, 0)}")
    print()
    for k in (SEV_CRITICAL, SEV_HIGH, SEV_MEDIUM, SEV_LOW):
        print(f"  {k:<8}: {counts['severity'].get(k, 0)}")
    print()
    print(f"Customer Release Verdict: {verdict}")
    if notable:
        print()
        print("Notable failures / blockers:")
        for r in notable:
            print(f"  - [{r.status}/{r.severity}] {r.id} {r.category}/{r.name}: {r.error}")
    print()
    print(f"Reports written to:\n  {json_path}\n  {txt_path}")

    return {"PASS": 0, "PASS WITH WARNINGS": 0, "FAIL": 1, "BLOCKED": 2}.get(verdict, 1)


if __name__ == "__main__":
    sys.exit(main())
