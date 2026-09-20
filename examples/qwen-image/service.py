import hmac, json, os, threading, time, uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import torch
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from diffusers import QwenImage21Pipeline

ROOT = Path('/output'); ROOT.mkdir(exist_ok=True)
TOKEN = Path('/run/model-key').read_text().strip()
MODEL = 'Qwen/Qwen-Image-2.1'
REVISION = 'b3179ad355be050328e483a9dfdd9e60cd62adfa'
state = {'state': 'loading', 'model': MODEL, 'revision': REVISION}
lock = threading.Lock(); pool = ThreadPoolExecutor(max_workers=1); jobs = {}; pipe = None

def load():
    global pipe
    try:
        pipe = QwenImage21Pipeline.from_pretrained(MODEL, revision=REVISION, local_files_only=True, torch_dtype=torch.bfloat16).to('cuda')
        pipe.vae.enable_tiling()
        state['state'] = 'ready'
    except Exception as error:
        state.update(state='error', error=str(error)[:500])
        print('Load failed:', error, flush=True)

@asynccontextmanager
async def lifespan(app):
    pool.submit(load)
    yield

app = FastAPI(lifespan=lifespan)
def auth(authorization: str = Header(default='')):
    if not TOKEN or not hmac.compare_digest(authorization, 'Bearer ' + TOKEN): raise HTTPException(401, 'Unauthorized')

class Request(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    size: int = Field(default=1024)
    steps: int = Field(default=40, ge=10, le=40)
    seed: int = Field(default=42, ge=0, le=2147483647)

def generate(job_id, request):
    job = jobs[job_id]; started = time.time()
    try:
        job['state'] = 'running'
        def progress(pipeline, step, timestep, kwargs):
            job['progress'] = round(100*(step+1)/request.steps)
            return kwargs
        with torch.inference_mode():
            image = pipe(prompt=request.prompt, width=request.size, height=request.size, output_resolution=request.size,
                         num_inference_steps=request.steps, generator=torch.Generator('cuda').manual_seed(request.seed), callback_on_step_end=progress).images[0]
        image.save(ROOT / (job_id + '.png'))
        job.update(state='complete', seconds=round(time.time()-started, 2), width=image.width, height=image.height)
        (ROOT / (job_id + '.json')).write_text(json.dumps(job))
    except Exception as error:
        job.update(state='error', error=str(error)[:500])
        print('Generation failed:', error, flush=True)
    finally:
        torch.cuda.empty_cache()
        lock.release()

@app.get('/health', dependencies=[Depends(auth)])
def health(): return dict(state, busy=lock.locked())

@app.post('/jobs', dependencies=[Depends(auth)])
def create(request: Request):
    if request.size not in [512, 1024, 2048]: raise HTTPException(400, 'Size must be 512, 1024, or 2048')
    if state['state'] != 'ready': raise HTTPException(503, 'Model is not ready')
    available = next(int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
    if available < 12*1024**3: raise HTTPException(409, 'Not enough free memory. Stop another model before generating.')
    if not lock.acquire(False): raise HTTPException(409, 'An image is already generating')
    job_id = uuid.uuid4().hex
    jobs[job_id] = {'id':job_id, 'state':'queued', 'progress':0, 'model':MODEL, 'seed':request.seed}
    pool.submit(generate, job_id, request)
    return jobs[job_id]

@app.get('/jobs/{job_id}', dependencies=[Depends(auth)])
def get_job(job_id: str):
    if len(job_id)!=32 or any(c not in '0123456789abcdef' for c in job_id): raise HTTPException(404)
    if job_id in jobs: return jobs[job_id]
    path = ROOT / (job_id + '.json')
    if path.exists(): return json.loads(path.read_text())
    raise HTTPException(404)

@app.get('/images/{job_id}', dependencies=[Depends(auth)])
def get_image(job_id: str):
    if len(job_id)!=32 or any(c not in '0123456789abcdef' for c in job_id): raise HTTPException(404)
    path = ROOT / (job_id + '.png')
    if not path.exists(): raise HTTPException(404)
    return FileResponse(path, media_type='image/png', filename='qwen-image-' + job_id + '.png')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8020, access_log=False)
