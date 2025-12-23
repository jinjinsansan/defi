FROM node:22-bullseye

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/contracts

ENV NODE_ENV=development
