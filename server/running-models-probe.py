import json
import subprocess
from pathlib import Path


def collect():
    services = json.loads(subprocess.check_output(['pm2', 'jlist'], text=True, timeout=3))
    gpu = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], text=True, timeout=3)
    try:
        container_pid = int(subprocess.check_output(['docker', 'inspect', '--format', '{{.State.Pid}}', '__PRIMARY_CONTAINER__'], text=True, stderr=subprocess.DEVNULL, timeout=3).strip())
    except Exception:
        container_pid = 0
    groups = {}
    for line in gpu.splitlines():
        fields = line.split(',')
        if len(fields) != 2:
            continue
        pid = int(fields[0].strip())
        memory = float(fields[1].strip()) if fields[1].strip().replace('.', '', 1).isdigit() else None
        ancestors, args = [], []
        current = pid
        for _ in range(32):
            if current <= 1 or current in ancestors:
                break
            ancestors.append(current)
            try:
                root = Path('/proc') / str(current)
                args.extend(root.joinpath('cmdline').read_bytes().decode(errors='replace').split('\0'))
                status = root.joinpath('status').read_text()
                current = int(next(row.split()[1] for row in status.splitlines() if row.startswith('PPid:')))
            except (OSError, StopIteration, ValueError):
                break
        service = next((s for s in services if s.get('pid', 0) in ancestors and s.get('pm2_env', {}).get('status') == 'online'), None)
        if not service and container_pid > 0 and container_pid in ancestors:
            service = next((s for s in services if s.get('name') == '__PRIMARY_SERVICE__' and s.get('pm2_env', {}).get('status') == 'online'), None)
        if not service:
            continue
        repository = None
        for arg in args:
            if 'models--' in arg and '/snapshots/' in arg:
                repository = arg.split('models--', 1)[1].split('/snapshots/', 1)[0].replace('--', '/')
                break
            if '/' in arg and not arg.startswith('/') and not arg.startswith('-') and '://' not in arg:
                repository = arg
        if not repository:
            continue
        name = service['name']
        group = groups.setdefault(name, {'serviceName': name, 'repository': repository, 'memoryMiB': 0, 'memoryKnown': True})
        group['memoryKnown'] = group['memoryKnown'] and memory is not None
        group['memoryMiB'] += memory or 0
    return [{'serviceName': g['serviceName'], 'repository': g['repository'], 'gpuMemoryGiB': round(g['memoryMiB'] / 1024, 2) if g['memoryKnown'] else None} for g in groups.values()]

try:
    print(json.dumps({'ok': True, 'models': collect()}))
except Exception:
    print(json.dumps({'ok': False, 'models': []}))
