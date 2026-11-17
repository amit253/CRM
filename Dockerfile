FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY backend/requirements.txt backend/requirements.txt
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r backend/requirements.txt

COPY . .
RUN npm run build \
  && chmod +x docker/start.sh \
  && mkdir -p /app/data

ENV PATH="/opt/venv/bin:${PATH}" \
    NODE_ENV=production \
    PHIGRAD_ENV=production \
    FASTAPI_BASE_URL=http://127.0.0.1:8001 \
    CRM_DATABASE_PATH=/app/data/phigrad-crm.sqlite3 \
    PORT=3000

EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bash", "docker/start.sh"]
