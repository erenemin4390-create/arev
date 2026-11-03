FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN python3 -m venv /opt/arev-venv \
  && /opt/arev-venv/bin/pip install --no-cache-dir --disable-pip-version-check -r requirements-media.txt
RUN pnpm build
RUN cp server/media/media_worker.py dist/media_worker.py

ENV NODE_ENV=production
ENV AREV_MEDIA_PYTHON=/opt/arev-venv/bin/python
ENV AREV_MEDIA_WORKER_PATH=/app/dist/media_worker.py
EXPOSE 3000
CMD ["pnpm", "start"]
