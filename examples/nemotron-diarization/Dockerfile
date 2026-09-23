FROM nvcr.io/nvidia/pytorch:25.11-py3
# NVIDIA's Sep 23 checkpoint needs architecture support newer than the
# latest published Transformers release used by the Spark's older services.
RUN python -m pip install --no-cache-dir \
    fastapi uvicorn soundfile \
    'git+https://github.com/huggingface/transformers@002e1edf5b5198488297f401dd853056b6521d02'
RUN python -c 'from transformers.models.nemotron3_diarization import Nemotron3DiarizationConfig; print(Nemotron3DiarizationConfig.model_type)'
