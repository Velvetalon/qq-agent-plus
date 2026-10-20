"""Linux integration checks use synthetic Python children, never real QQ."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / 'scripts' / 'qq-supervisor.py'
FAKE = r'''
import json,os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(os.environ['HOME'])
with (root/'events.jsonl').open('a') as log:
 log.write(json.dumps({'pid':os.getpid(),'args':sys.argv[1:]})+'\n')
mode=os.environ.get('FAKE_QQ_MODE','normal')
if '--become-child' in sys.argv:
 time.sleep(0.15)
 os.execve(sys.executable,[sys.executable,__file__,'--type=zygote'],os.environ)
if '--type=zygote' not in sys.argv and '--relaunch' not in sys.argv:
 if mode=='relaunch':
  subprocess.Popen([sys.executable,__file__,'--relaunch'],start_new_session=True)
  time.sleep(0.15)
  raise SystemExit(1)
 if mode=='crash':
  time.sleep(0.15)
  raise SystemExit(1)
 if mode=='with-child':
  subprocess.Popen([sys.executable,__file__,'--type=zygote'],start_new_session=True)
 if mode=='with-transient-child':
  subprocess.Popen([sys.executable,__file__,'--become-child'],start_new_session=True)
while True: time.sleep(0.1)
'''


@unittest.skipUnless(sys.platform == 'linux' and os.getuid() != 0, 'requires non-root Linux /proc')
class QQSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='qq-singleton-test-')
        self.home = Path(self.temporary.name)
        self.fake = self.home / 'fake-qq.py'
        self.fake.write_text(FAKE)
        self.env = {**os.environ, 'HOME': str(self.home), 'SNOWLUMA_EXTRA_QQ_HOMES': ''}
        self.children = []
        self.handles = []

    def events(self):
        file = self.home / 'events.jsonl'
        return [json.loads(line) for line in file.read_text().splitlines()] if file.exists() else []

    def guardian_logs(self):
        return '\n'.join(path.read_text() for path in self.home.glob('guard-*.log'))

    def alive(self, pid):
        try:
            fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
            return fields[0] != 'Z'
        except FileNotFoundError:
            return False

    def wait_for(self, predicate, timeout=8):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.03)
        self.fail('condition timed out; events=' + repr(self.events()) + '\n' + self.guardian_logs())

    def start_fake(self, mode='normal'):
        child = subprocess.Popen([sys.executable, str(self.fake)], env={**self.env, 'FAKE_QQ_MODE': mode}, start_new_session=True)
        self.children.append(child)
        self.wait_for(lambda: any(event['pid'] == child.pid for event in self.events()))
        return child

    def guard(self, mode='normal', container_scope=False):
        log = (self.home / f'guard-{len(self.children)}.log').open('w')
        self.handles.append(log)
        child = subprocess.Popen([
            sys.executable, str(GUARD), '--executable', sys.executable,
            '--poll-interval', '0.03', '--handoff-grace', '0.5', '--stop-timeout', '1.5',
            *(['--container-scope'] if container_scope else []), '--', str(self.fake)
        ], env={**self.env, 'FAKE_QQ_MODE': mode}, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        self.children.append(child)
        return child

    def stop_guard(self, guard):
        guard.terminate()
        self.assertEqual(guard.wait(timeout=6), 0)
        self.wait_for(lambda: not any(self.alive(event['pid']) for event in self.events()))

    def tearDown(self):
        for child in reversed(self.children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=4)
        # Only recorded synthetic children whose HOME is this unique fixture.
        for event in self.events():
            pid = event['pid']
            if not self.alive(pid):
                continue
            try:
                env = Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
                if f'HOME={self.home}'.encode() in env:
                    os.kill(pid, signal.SIGKILL)
            except (FileNotFoundError, ProcessLookupError):
                pass
        for handle in self.handles:
            handle.close()
        self.temporary.cleanup()

    def test_container_scope_requires_the_dedicated_qq_container(self):
        guard = self.guard(container_scope=True)
        self.assertEqual(guard.wait(timeout=6), 1)
        self.assertEqual(self.events(), [])
        self.assertIn('dedicated SnowLuma PID namespace', self.guardian_logs())

    def test_starts_one_process_and_stops_it(self):
        guard = self.guard()
        self.wait_for(lambda: len(self.events()) == 1)
        self.assertIsNone(guard.poll())
        self.stop_guard(guard)
        self.assertEqual(len(self.events()), 1)

    def test_adopts_one_existing_process_without_spawning(self):
        original = self.start_fake()
        guard = self.guard()
        self.wait_for(lambda: any(self.home.glob('guard-*.log')) and any('adopted' in p.read_text() for p in self.home.glob('guard-*.log')))
        self.assertEqual(len(self.events()), 1)
        self.assertIsNone(original.poll())
        self.stop_guard(guard)

    def test_multiple_existing_processes_fail_closed_without_killing_them(self):
        first = self.start_fake()
        second = self.start_fake()
        guard = self.guard()
        self.assertEqual(guard.wait(timeout=6), 1)
        self.assertEqual(len(self.events()), 2)
        self.assertIn('Multiple existing QQ main processes', self.guardian_logs())
        self.assertIsNone(first.poll())
        self.assertIsNone(second.poll())

    def test_relaunch_exit_one_is_adopted_without_third_process(self):
        guard = self.guard('relaunch')
        self.wait_for(lambda: len(self.events()) == 2)
        self.wait_for(lambda: not self.alive(self.events()[0]['pid']))
        self.wait_for(lambda: any('relaunch-adopted' in p.read_text() for p in self.home.glob('guard-*.log')))
        self.assertIsNone(guard.poll())
        self.assertEqual(len(self.events()), 2)
        self.assertTrue(self.alive(self.events()[1]['pid']))
        self.stop_guard(guard)

    def test_crash_without_handoff_returns_failure_for_supervisor(self):
        guard = self.guard('crash')
        self.assertEqual(guard.wait(timeout=6), 1)
        self.assertEqual(len(self.events()), 1)

    def test_second_guard_is_locked_out(self):
        first = self.guard()
        self.wait_for(lambda: len(self.events()) == 1)
        second = self.guard()
        self.assertEqual(second.wait(timeout=6), 75)
        self.assertEqual(len(self.events()), 1)
        self.assertIsNone(first.poll())
        self.stop_guard(first)

    def test_transient_fork_settles_without_guard_restart(self):
        guard = self.guard('with-transient-child')
        self.wait_for(lambda: any('--type=zygote' in event['args'] for event in self.events()))
        self.assertIsNone(guard.poll(), self.guardian_logs())
        self.assertNotIn('refused', self.guardian_logs())
        self.assertEqual(len({event['pid'] for event in self.events()}), 2)
        self.stop_guard(guard)

    def test_persistent_duplicate_during_run_fails_without_spawning_more(self):
        guard = self.guard()
        self.wait_for(lambda: len(self.events()) == 1)
        other = self.start_fake()
        self.assertEqual(guard.wait(timeout=6), 1)
        self.assertIn('bounded handoff deadline', self.guardian_logs())
        self.assertEqual(len(self.events()), 2)
        self.assertIsNone(other.poll())

    def test_chromium_child_is_not_counted_as_second_main_and_is_stopped(self):
        guard = self.guard('with-child')
        self.wait_for(lambda: len(self.events()) == 2)
        self.assertTrue(any('--type=zygote' in event['args'] for event in self.events()))
        self.assertIsNone(guard.poll())
        self.stop_guard(guard)


if __name__ == '__main__':
    unittest.main(verbosity=2)
