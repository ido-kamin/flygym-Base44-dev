FROM python:3.14-slim

# Only runtime/system dependencies live in the image; source is bind-mounted.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libegl1 libgl1 libopengl0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.8.22
WORKDIR /app
