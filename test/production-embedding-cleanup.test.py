import ast, hashlib, json, os, pathlib, re, unittest
from urllib.error import HTTPError, URLError

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'delay/implementation/2026-10-20-production-update/apply-update.sh'
EXCS = (HTTPError, URLError, TimeoutError, json.JSONDecodeError)
CASES = [('save-false','save',False), *[(f'save-{e.__name__}','save',e) for e in EXCS], ('test-false','test',False), *[(f'test-{e.__name__}','test',e) for e in EXCS], ('dimension-1024','dimension',1024), ('test-nondict','nondict',None), *[(f'pause-{e.__name__}','pause',e) for e in EXCS], ('pause-false','pause',False)]
SETTINGS, TEST = '/api/embedding/settings', '/api/embedding/test'
PATCH = {'synthetic': True}
BUILTINS = {'Exception': Exception, 'AssertionError': AssertionError, 'str': str}

def candidates(text):
    found = []
    for match in re.finditer(r"python3\s+-\s+<<['\"]?PY['\"]?\s*\n(.*?)\nPY", text, re.S):
        tree = ast.parse(match.group(1))
        found.extend(n for n in ast.walk(tree) if isinstance(n, ast.Try) and
            any(isinstance(x, ast.Call) and isinstance(x.func, ast.Name) and x.func.id == 'embedding_api' and x.args and isinstance(x.args[0], ast.Constant) and x.args[0].value == SETTINGS for x in ast.walk(n)) and
            any(isinstance(x, ast.Call) and isinstance(x.func, ast.Name) and x.func.id == 'embedding_api' and x.args and isinstance(x.args[0], ast.Constant) and x.args[0].value == TEST for x in ast.walk(n)) and
            any(isinstance(x, ast.Name) and x.id == 'indexing_pause_confirmed' for h in n.handlers for x in ast.walk(h)))
    return found

def target_try(text=None):
    if text is None:
        path = pathlib.Path(os.environ.get('QQ_DEPLOY_CLEANUP_SCRIPT', DEFAULT))
        text = path.read_text(encoding='utf-8')
    found = candidates(text)
    if len(found) != 1:
        raise AssertionError('target try count='+str(len(found)))
    return found[0]

def exec_node(node, api):
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    ns = {'embedding_api': api, 'embedding_patch': PATCH, '__builtins__': BUILTINS}
    try:
        exec(compile(module, '<selected-try>', 'exec'), ns)
    except Exception as exc:
        return exc
    return None

class CleanupTests(unittest.TestCase):
    def executor(self, mode, value):
        calls = []
        def api(route, body):
            calls.append((route, body))
            key = 'save' if route == SETTINGS and body != {'enabled': False} else 'pause' if route == SETTINGS else 'test'
            if mode == 'pause' and key == 'test': return {'ok': False}
            inject = key == mode or mode in ('dimension', 'nondict') and key == 'test'
            if inject:
                if isinstance(value, type) and issubclass(value, BaseException):
                    if value is json.JSONDecodeError: raise value('synthetic', '{}', 0)
                    if value is HTTPError: raise value('https://invalid', 500, 'synthetic', {}, None)
                    if value is URLError: raise value('synthetic')
                    raise value('synthetic')
                if key in ('save', 'test') and value is False: return {'ok': False}
                if mode == 'nondict': return []
                if mode == 'dimension': return {'ok': True, 'dimension': value}
                if key == 'pause' and value is False: return {'ok': False}
            return {'ok': True, 'dimension': 2560}
        return api, calls

    def run_case(self, mode, value):
        api, calls = self.executor(mode, value)
        return exec_node(target_try(), api), calls

    def test_scenarios(self):
        self.assertEqual(len(CASES), 17)
        for name, mode, value in CASES:
            with self.subTest(name=name):
                err, calls = self.run_case(mode, value)
                self.assertIsInstance(err, AssertionError)
                expected_flag = 'indexingPauseConfirmed=False' if mode == 'pause' else 'indexingPauseConfirmed=True'
                self.assertIn(expected_flag, str(err))
                expected = [(SETTINGS, PATCH)] if mode == 'save' else [(SETTINGS, PATCH), (TEST, {})]
                if mode == 'save': expected += [(SETTINGS, {'enabled': False})]
                elif mode == 'pause': expected += [(SETTINGS, {'enabled': False})]
                else: expected += [(SETTINGS, {'enabled': False})]
                self.assertEqual(calls, expected)

    def test_success_no_pause(self):
        err, calls = self.run_case('never', None)
        self.assertIsNone(err)
        self.assertEqual(calls, [(SETTINGS, PATCH), (TEST, {})])

    def test_unique_candidate_guard(self):
        snippet = 'try:\n embedding_api("%s", {})\n embedding_api("%s", {})\nexcept Exception:\n indexing_pause_confirmed=False\n raise AssertionError("x")\n' % (SETTINGS, TEST)
        source = 'python3 - <<\'PY\'\n' + snippet + '\nPY\n'
        self.assertEqual(len(candidates(source)), 1)
        with self.assertRaisesRegex(AssertionError, 'target try count=2'):
            target_try(source + source.replace('"%s"' % SETTINGS, '"%s"' % SETTINGS, 1))

    def legacy(self, mode):
        old = ast.parse('''saved = embedding_api("/api/embedding/settings", embedding_patch)\nassert saved.get("ok") is True\ntest = embedding_api("/api/embedding/test", {})\nif test.get("ok") is not True:\n embedding_api("/api/embedding/settings", {"enabled": False})\n raise AssertionError("test failed")\nassert test.get("dimension") == 2560\n''')
        api, calls = self.executor('test' if mode == 'http' else 'dimension', HTTPError if mode == 'http' else 1024)
        ns = {'embedding_api': api, 'embedding_patch': PATCH, '__builtins__': BUILTINS}
        try:
            exec(compile(old, '<legacy-minimal-fixture>', 'exec'), ns)
        except Exception:
            pass
        self.assertNotIn((SETTINGS, {'enabled': False}), calls)
        return calls

    def test_legacy_red_baselines(self):
        for mode in ('http', 'dimension'):
            with self.subTest(mode=mode):
                calls = self.legacy(mode)
                self.assertEqual([r for r, _ in calls], [SETTINGS, TEST])
                try:
                    self.assertIn((SETTINGS, {'enabled': False}), calls)
                except AssertionError as contract_failure:
                    self.assertIsInstance(contract_failure, AssertionError)
                else:
                    self.fail('legacy fixture unexpectedly satisfied pause contract')

if __name__ == '__main__': unittest.main(verbosity=2)
