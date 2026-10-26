FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip build-essential && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev
COPY backend/src ./src
COPY backend/src/db ./src/db
COPY ml-service /app/ml-service
RUN python3 -m venv /app/ml-service/.venv && /app/ml-service/.venv/bin/pip install --no-cache-dir -r /app/ml-service/requirements.txt
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
ENV PYTHON_BIN=/app/ml-service/.venv/bin/python
ENV PORT=10000
EXPOSE 10000
CMD ["node", "src/index.js"]
