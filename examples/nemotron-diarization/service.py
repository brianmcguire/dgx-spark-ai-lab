"""Small, authenticated speaker diarization service for one DGX Spark."""

import hmac
import io
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from transformers import AutoModelForAudioFrameClassification, AutoProcessor


MODEL = "nvidia/Nemotron-3-Diarization"
REVISION = "a435e9867d79e789e90053f9b6d6834053af564a"
TOKEN = Path("/run/model-key").read_text().strip()
state = {"state": "loading", "model": MODEL, "revision": REVISION}
processor = None
model = None
lock = threading.Lock()


def load():
    global processor, model
    try:
        processor = AutoProcessor.from_pretrained(MODEL, revision=REVISION, local_files_only=True)
        model = AutoModelForAudioFrameClassification.from_pretrained(
            MODEL, revision=REVISION, local_files_only=True, dtype=torch.float32
        ).to("cuda").eval()
        state["state"] = "ready"
    except Exception as error:
        state.update(state="error", error=str(error)[:500])
        print("Diarization load failed:", error, flush=True)


@asynccontextmanager
async def lifespan(_app):
    threading.Thread(target=load, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)


def auth(authorization: str = Header(default="")):
    if not TOKEN or not hmac.compare_digest(authorization, "Bearer " + TOKEN):
        raise HTTPException(401, "Unauthorized")


@app.get("/health", dependencies=[Depends(auth)])
def health():
    return dict(state, busy=lock.locked(), task="speaker diarization", maxSpeakers=8)


@app.post("/diarize", dependencies=[Depends(auth)])
async def diarize(request: Request):
    if state["state"] != "ready":
        raise HTTPException(503, "Model is not ready")
    if int(request.headers.get("content-length", "0")) > 20_000_000:
        raise HTTPException(413, "Audio file exceeds 20 MB")
    body = await request.body()
    if not body or len(body) > 20_000_000:
        raise HTTPException(413, "Send a WAV file under 20 MB")
    try:
        audio, sample_rate = sf.read(io.BytesIO(body), dtype="float32")
    except Exception:
        raise HTTPException(400, "Send a valid WAV file")
    if sample_rate != 16000 or audio.ndim != 1:
        raise HTTPException(400, "Audio must be mono, 16 kHz WAV")
    if len(audio) > 16000 * 600:
        raise HTTPException(413, "Audio must be at most 10 minutes")
    if not lock.acquire(False):
        raise HTTPException(409, "A diarization request is already running")
    try:
        inputs = processor(np.asarray(audio), sampling_rate=sample_rate).to(model.device, dtype=model.dtype)
        with torch.inference_mode():
            logits = model(**inputs).logits
        segments = processor.extract_speaker_dict(logits, inputs.attention_mask)[0]
        return {
            "model": MODEL,
            "durationSeconds": round(len(audio) / sample_rate, 2),
            "segments": [
                {"speaker": int(item["Speaker"]), "start": float(item["Start"]), "end": float(item["End"])}
                for item in segments
            ],
        }
    finally:
        lock.release()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8021")), access_log=False)
