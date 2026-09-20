# Qwen Image 2.1 service

Optional image-generation service, separate from the dashboard's primary vLLM chat endpoint.
The included Dockerfile uses NVIDIA's ARM64-capable PyTorch runtime and a pinned upstream Diffusers commit.
The model uses the Qwen Research License; commercial deployment requires a separate license.

Download and verify `Qwen/Qwen-Image-2.1` revision `b3179ad355be050328e483a9dfdd9e60cd62adfa` with `hf download` and `hf cache verify`.
Build the container from this directory. Run `python /app/service.py` with GPU access,
`HF_HOME=/hf`, `HF_HUB_OFFLINE=1`, and these mounts:

- HF cache mounted read-only at `/hf`
- `service.py` mounted at `/app/service.py`
- A nonempty bearer-token file mounted read-only at `/run/model-key`
- A private, writable output directory at `/output`

Port 8020 must be bound to a trusted interface. Use an isolated runtime; do not install these dependencies into the existing chat model environment.
Allow at least 48 GiB available memory before starting. On the validated single-Spark setup, Sentinel is stopped and Qwen 27B remains online. Only one image job runs at once. A 12 GiB free-memory guard rejects jobs when headroom is low. Do not infer a peak runtime requirement from checkpoint size alone.

Configure the dashboard with:

```json
{
  "imageGeneration": { "enabled": true, "apiUrl": "http://YOUR_SPARK:8020" },
  "controller": {
    "secondaryServices": [
      { "serviceName": "spark-qwen-image", "containerName": "spark-qwen-image", "label": "Qwen Image 2.1", "kind": "image", "conflictsWith": ["sentinel-nemotron"] }
    ]
  }
}
```

Merge the entry into existing secondary services. Set `IMAGE_API_KEY` on the dashboard if the image token differs from its configured inference key. Keys are never sent to the browser. PM2's launcher must stop its container on termination. The service uses an asynchronous job API, persists completed PNGs, and supports text-to-image generation in Image Studio. Image editing is not exposed by this dashboard yet.
