FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libegl1 libgl1 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.14 /uv /usr/local/bin/uv
WORKDIR /app
