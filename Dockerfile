FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 python3-venv libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix ./backend

COPY ml-service/requirements.txt ./ml-service/requirements.txt

# xgboost declares a Linux-only transitive dependency on nvidia-nccl-cu12 (~350 MB) for
# distributed GPU communication. This service does single-process CPU inference:
# xgboost imports NCCL lazily inside collective.CommunicatorContext (wrapped in
# try/except ImportError) and predict.py never reaches it. Install every requirement
# normally, then xgboost itself with --no-deps, so the CUDA wheel is never downloaded.
# The version is read back out of requirements.txt so it cannot drift.
RUN python3 -m venv /app/ml-service/.venv \
    && grep -v -E '^[[:space:]]*xgboost[[:space:]]*==' /app/ml-service/requirements.txt > /tmp/requirements-no-xgboost.txt \
    && /app/ml-service/.venv/bin/python -m pip install --no-cache-dir -r /tmp/requirements-no-xgboost.txt \
    && XGBOOST_VERSION="$(sed -n -E 's/^[[:space:]]*xgboost[[:space:]]*==[[:space:]]*([^[:space:]]+).*/\1/p' /app/ml-service/requirements.txt)" \
    && test -n "$XGBOOST_VERSION" \
    && /app/ml-service/.venv/bin/python -m pip install --no-cache-dir --no-deps "xgboost==$XGBOOST_VERSION" \
    && ! /app/ml-service/.venv/bin/python -m pip list 2>/dev/null | grep -qi '^nvidia-'

COPY backend/src ./backend/src
COPY backend/scripts ./backend/scripts
COPY ml-service/predict.py ml-service/feature_engineering.py ./ml-service/
COPY ml-service/model/xgb_duplicate_model.joblib ./ml-service/model/xgb_duplicate_model.joblib

RUN test -s /app/ml-service/model/xgb_duplicate_model.joblib \
    && /app/ml-service/.venv/bin/python -c "import sys; sys.path.insert(0, '/app/ml-service'); from predict import load_model; assert hasattr(load_model(), 'predict_proba')" \
    && /app/ml-service/.venv/bin/python -c "import sys; sys.path.insert(0, '/app/ml-service'); from predict import predict_pairs; first={'full_name': 'Mary Otieno', 'date_of_birth': '2010-04-12', 'school_code': 'SCH-001', 'guardian_id': 'G-1001'}; second={'full_name': 'Mary Anyango', 'date_of_birth': '2010-04-12', 'school_code': 'SCH-001', 'guardian_id': 'G-1002'}; result=predict_pairs([{'first': first, 'second': second}]); score=result[0]['score']; print('inference gate score:', score); assert 0.0 <= score <= 1.0"

ENV NODE_ENV=production \
    PYTHON_EXECUTABLE=/app/ml-service/.venv/bin/python

EXPOSE 5000
CMD ["node", "backend/src/index.js"]
