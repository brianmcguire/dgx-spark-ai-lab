import ast
import json
import unittest
from pathlib import Path
from unittest.mock import patch

source = Path(__file__).parents[1].joinpath('server/running-models-probe.py').read_text()
module = ast.parse(source)
module.body = [node for node in module.body if not isinstance(node, ast.Try)]
namespace = {}
exec(compile(module, 'probe', 'exec'), namespace)

class FakePath:
    def __init__(self, value): self.value = str(value)
    def __truediv__(self, value): return FakePath(self.value + '/' + str(value))
    def joinpath(self, value): return self / value
    def read_bytes(self):
        return b'vllm\0/home/test/models--nvidia--Omni/snapshots/revision\0' if '/20/' in self.value else b'vllm\0nvidia/Qwen\0'
    def read_text(self): return 'PPid:\t1\n'

class RunningModelsTest(unittest.TestCase):
    def probe(self, secondary=True, fail=False):
        def output(command, **kwargs):
            if fail: raise RuntimeError('unavailable')
            if command[0] == 'pm2': return json.dumps([{'name':'__PRIMARY_SERVICE__','pid':99,'pm2_env':{'status':'online'}}, {'name':'sentinel','pid':20,'pm2_env':{'status':'online' if secondary else 'stopped'}}])
            if command[0] == 'docker': return '10'
            return '10, 1024\n20, 2048\n'
        with patch.dict(namespace, Path=FakePath), patch.object(namespace['subprocess'], 'check_output', side_effect=output):
            return namespace['collect']()
    def test_two_models(self):
        result = self.probe()
        self.assertEqual(len(result), 2)
        self.assertEqual(result[1]['gpuMemoryGiB'], 2)
    def test_stopped_secondary_is_omitted(self):
        result = self.probe(secondary=False)
        self.assertEqual([x['serviceName'] for x in result], ['__PRIMARY_SERVICE__'])
    def test_probe_error_is_not_empty_success(self):
        with self.assertRaises(RuntimeError): self.probe(fail=True)

unittest.main()
