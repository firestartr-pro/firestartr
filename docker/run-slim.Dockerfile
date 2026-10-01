FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      grep \
      vim \
      less \
      && apt-get clean \
      && rm -rf /var/lib/apt/lists/* \
      && npm cache clean --force \
      && rm -rf /root/.cache
