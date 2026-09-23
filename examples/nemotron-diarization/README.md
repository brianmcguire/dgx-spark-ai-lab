# Nemotron 3 Diarization on one DGX Spark

This service labels **who spoke when** in mono 16 kHz audio. It supports up to eight speakers and runs independently from the dashboard's primary chat model. It does not transcribe speech.

The model is [nvidia/Nemotron-3-Diarization](https://huggingface.co/nvidia/Nemotron-3-Diarization), pinned to revision `a435e9867d79e789e90053f9b6d6834053af564a`. The Transformers weights are 396,954,592 bytes. The separate NeMo-format file is 198,676,480 bytes. Both can be kept in the Hugging Face cache for future use. The container uses a pinned Transformers source commit because the model architecture was not recognized by the published 5.17 release at installation time.

On the Spark, download the checkpoint and build the runtime:

```bash
hf download nvidia/Nemotron-3-Diarization \
  --revision a435e9867d79e789e90053f9b6d6834053af564a \
  --include '*.nemo' --include '*.safetensors' --include '*.json' --include README.md
docker build -t spark-lab/nemotron-3-diarization:20260923 .
```

Set `SPARK_BIND_IP` to the Spark's private interface and `MODEL_API_KEY_FILE` to a local file containing a bearer token. Run `serve.sh` under PM2 if you want the dashboard's Start/Stop control to manage it:

```bash
pm2 start ./serve.sh --name spark-nemotron-diarization --interpreter bash --no-autorestart
pm2 save
```

Add this object to `controller.secondaryServices` in your private `config/dashboard.local.json`:

```json
{
  "serviceName": "spark-nemotron-diarization",
  "containerName": "spark-nemotron-diarization",
  "label": "Nemotron 3 Diarization",
  "kind": "audio"
}
```

The dashboard detects the pinned checkpoint in the Hugging Face cache and displays its own audio card. Its Start/Stop button controls this PM2 service; it never replaces the primary LLM.

`GET /health` and `POST /diarize` require `Authorization: Bearer <token>`. Post a mono 16 kHz WAV body up to 10 minutes and 20 MB to `/diarize`. The response contains speaker number and start/end seconds for each segment. Keep the endpoint on a trusted private network.
