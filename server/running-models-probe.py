import json
import subprocess
from pathlib import Path


gpu_process_count = None

def collect():
    global gpu_process_count
    services = json.loads(subprocess.check_output(['pm2', 'jlist'], text=True, timeout=3))
    gpu = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], text=True, timeout=3)
    containers = {'__PRIMARY_CONTAINER__': '__PRIMARY_SERVICE__'}
    containers.update(json.loads('__SECONDARY_CONTAINERS__'.replace('__SECONDARY_' + 'CONTAINERS__', '{}')))
    container_services = {}
    for container, service_name in containers.items():
        try:
            pid = int(subprocess.check_output(['docker', 'inspect', '--format', '{{.State.Pid}}', container], text=True, stderr=subprocess.DEVNULL, timeout=3).strip())
            if pid > 0:
                container_services[pid] = service_name
        except Exception:
            pass
    gpu_process_count = len([line for line in gpu.splitlines() if line.strip()])
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
        if not service:
            service_name = next((name for pid, name in container_services.items() if pid in ancestors), None)
            service = next((s for s in services if service_name and s.get('name') == service_name and s.get('pm2_env', {}).get('status') == 'online'), None)
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
    models = collect()
    print(json.dumps({'ok': True, 'models': models, 'gpuProcessCount': gpu_process_count}))
except Exception:
    print(json.dumps({'ok': False, 'models': []}))
