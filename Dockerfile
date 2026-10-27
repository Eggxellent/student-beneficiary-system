FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 python3-venv libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix ./backend

COPY ml-service/requirements.txt ./ml-service/requirements.txt
RUN python3 -m venv /app/ml-service/.venv \
    && /app/ml-service/.venv/bin/python -m pip install --no-cache-dir -r /app/ml-service/requirements.txt

COPY backend/src ./backend/src
COPY ml-service/predict.py ml-service/feature_engineering.py ./ml-service/
COPY ml-service/model/xgb_duplicate_model.joblib ./ml-service/model/xgb_duplicate_model.joblib

RUN test -s /app/ml-service/model/xgb_duplicate_model.joblib \
    && /app/ml-service/.venv/bin/python -c "import sys; sys.path.insert(0, '/app/ml-service'); from predict import load_model; assert hasattr(load_model(), 'predict_proba')"

ENV NODE_ENV=production \
    PYTHON_EXECUTABLE=/app/ml-service/.venv/bin/python

EXPOSE 5000
CMD ["node", "backend/src/index.js"]
