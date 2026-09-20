FROM nvcr.io/nvidia/pytorch:25.11-py3
RUN python -m pip install --no-cache-dir 'transformers>=5.17,<6' accelerate pillow fastapi uvicorn 'git+https://github.com/huggingface/diffusers@80c7ed262aeffbeb43ef13ae04baeb9b84515a69'
RUN python -m pip uninstall -y torchao
RUN python -c 'from diffusers import QwenImage21Pipeline; print("Qwen Image 2.1 pipeline available")'
