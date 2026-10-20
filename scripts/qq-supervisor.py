#!/usr/bin/python3
"""Keep one QQ main process across Electron relaunch and Supervisor restarts."""
import argparse
import contextlib
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass


class UnsafeState(RuntimeError):
    pass


@dataclass(frozen=True)
class QQProcess:
    pid: int
    started: int
    args: tuple

    @property
    def identity(self):
        return self.pid, self.started


def process_state(pid):
    text = Path(f"/proc/{pid}/stat").read_text()
    fields = text.rsplit(")", 1)[1].split()
    return fields[0], int(fields[19])


class QQContext:
    def __init__(self, executable, home, container_scope=False):
        self.executable = str(Path(executable).resolve(strict=True))
        self.names = {Path(executable).name[:15], Path(self.executable).name[:15]}
        self.home = str(Path(home).resolve(strict=True))
        self.uid = os.getuid()
        self.container_scope = container_scope
        if container_scope and (self.executable != '/opt/QQ/qq' or self.home != '/app'
                                or Path('/proc/1/comm').read_text().strip() != 'supervisord'):
            raise UnsafeState('Container-scoped supervision requires the dedicated SnowLuma PID namespace')

    def public_executable(self, args):
        name = args[0]
        if name == '/proc/self/exe' and any(value.startswith('--type=') for value in args):
            return self.executable
        candidate = name if os.path.isabs(name) else shutil.which(name)
        return str(Path(candidate).resolve()) if candidate else None

    def processes(self, include_children=False):
        found = []
        for directory in Path("/proc").iterdir():
            if not directory.name.isdigit():
                continue
            pid = int(directory.name)
            if pid == os.getpid():
                continue
            try:
                if directory.stat().st_uid != self.uid:
                    continue
                if (directory / "comm").read_text().strip() not in self.names:
                    continue
                state, started = process_state(pid)
                if state == "Z":
                    continue
                args = tuple(v.decode(errors="replace") for v in (directory / "cmdline").read_bytes().split(b"\0") if v)
                if not args or str(Path(__file__).resolve()) in args:
                    continue
                if not include_children and any(v.startswith("--type=") for v in args):
                    continue
                try:
                    executable = os.readlink(directory / "exe").removesuffix(" (deleted)")
                except PermissionError:
                    if not self.container_scope:
                        raise
                    # Hooked QQ protects exe/environ even from its own UID.
                    # In the dedicated single-account container, validate public
                    # command identity rather than granting ptrace/root access.
                    executable = self.public_executable(args)
                if executable != self.executable:
                    if self.container_scope:
                        raise UnsafeState(f'Unexpected QQ executable for PID {pid}')
                    continue
                try:
                    env = dict(v.split(b"=", 1) for v in (directory / "environ").read_bytes().split(b"\0") if b"=" in v)
                    home = env.get(b"HOME", b"").decode(errors="replace")
                except PermissionError:
                    if not self.container_scope:
                        raise
                    home = self.home
                if not home or str(Path(home).resolve()) != self.home:
                    if self.container_scope:
                        raise UnsafeState(f'Additional QQ HOME is not allowed for PID {pid}')
                    continue
                found.append(QQProcess(pid, started, args))
            except (FileNotFoundError, ProcessLookupError):
                continue
            except PermissionError as error:
                raise UnsafeState(f"Cannot establish process ownership for PID {pid}") from error
        return sorted(found, key=lambda p: (p.started, p.pid))

    @staticmethod
    def send(process, sig):
        try:
            state, started = process_state(process.pid)
            if state != "Z" and started == process.started:
                os.kill(process.pid, sig)
        except (FileNotFoundError, ProcessLookupError):
            pass


def log(event, **fields):
    details = " ".join(f"{key}={value}" for key, value in fields.items())
    print(f"[qq-supervisor] {event} {details}".rstrip(), flush=True)


def stop_context(context, timeout, child):
    """Operator stop includes a relaunch that moved to another process group."""
    deadline = time.monotonic() + timeout
    sent = set()
    while True:
        if child is not None:
            child.poll()
        processes = context.processes(include_children=True)
        if not processes:
            return
        now = time.monotonic()
        sig = signal.SIGKILL if now >= deadline - min(2.0, timeout / 3) else signal.SIGTERM
        for process in processes:
            key = process.identity, sig
            if key not in sent:
                context.send(process, sig)
                sent.add(key)
        if now >= deadline:
            raise UnsafeState("QQ processes did not stop within the shutdown deadline")
        time.sleep(0.05)


def supervise(context, args, stopping, poll_interval, handoff_grace, stop_timeout):
    child = None
    current = None
    try:
        processes = context.processes()
        if len(processes) > 1:
            raise UnsafeState("Multiple existing QQ main processes; refusing to launch or select one")
        if processes:
            current = processes[0].identity
            log("adopted", pid=processes[0].pid)
        elif not stopping.is_set():
            # QQ relaunch may detach itself; the stable guardian, not this PID,
            # remains the child tracked by Supervisor.
            child = subprocess.Popen([context.executable, *args], start_new_session=True)
            with contextlib.suppress(FileNotFoundError, ProcessLookupError):
                current = child.pid, process_state(child.pid)[1]
            log("started", pid=child.pid)
        missing_since = None
        duplicate_since = None
        while not stopping.is_set():
            exit_code = child.poll() if child is not None else None
            processes = context.processes()
            now = time.monotonic()
            if len(processes) > 1:
                identities = {p.identity for p in processes}
                relaunch = any("--relaunch" in p.args and p.identity != current for p in processes)
                if len(processes) != 2 or current not in identities or not relaunch:
                    raise UnsafeState("Unexpected duplicate QQ instances; no additional process will be started")
                if duplicate_since is None:
                    duplicate_since = now
                    log("relaunch-handoff-pending")
                if now - duplicate_since >= handoff_grace:
                    raise UnsafeState("QQ relaunch did not retire the old instance within the handoff deadline")
            elif processes:
                process = processes[0]
                if process.identity != current:
                    log("relaunch-adopted", pid=process.pid)
                current = process.identity
                missing_since = None
                duplicate_since = None
            else:
                duplicate_since = None
                if missing_since is None:
                    missing_since = now
                if now - missing_since >= handoff_grace:
                    log("exited-without-handoff", status=exit_code)
                    return exit_code if exit_code is not None and exit_code > 0 else 1
            stopping.wait(poll_interval)
        log("stopping")
        stop_context(context, stop_timeout, child)
        log("stopped")
        return 0
    finally:
        if child is not None:
            child.poll()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", default="/opt/QQ/qq")
    parser.add_argument("--container-scope", action="store_true")
    parser.add_argument("--poll-interval", type=float, default=0.25)
    parser.add_argument("--handoff-grace", type=float, default=3.0)
    parser.add_argument("--stop-timeout", type=float, default=8.0)
    parser.add_argument("qq_args", nargs=argparse.REMAINDER)
    options = parser.parse_args(argv)
    if sys.platform != "linux":
        parser.error("QQ supervision requires Linux /proc and flock")
    if os.getuid() == 0:
        parser.error("QQ must run as the non-root service user")
    if min(options.poll_interval, options.handoff_grace, options.stop_timeout) <= 0:
        parser.error("Timing limits must be positive")
    if os.environ.get("SNOWLUMA_EXTRA_QQ_HOMES", "").strip():
        parser.error("Extra QQ homes are incompatible with this single-instance deployment")
    import fcntl
    context = QQContext(options.executable, os.environ["HOME"], options.container_scope)
    folder = Path(context.home) / ".cache" / "qq-agent-supervisor"
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = folder / "singleton.lock"
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("already-supervised")
            return 75
        stopping = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda _sig, _frame: stopping.set())
        args = options.qq_args[1:] if options.qq_args[:1] == ["--"] else options.qq_args
        try:
            return supervise(context, args, stopping, options.poll_interval, options.handoff_grace, options.stop_timeout)
        except (UnsafeState, OSError) as error:
            log("refused", reason=str(error))
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
