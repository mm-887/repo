FROM node:20-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    HF_HOME=/home/user/hf \
    PYTHONUNBUFFERED=1 \
    PATH=/home/user/.local/bin:$PATH

WORKDIR /app
RUN chown user:user /app
USER user

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir --user -r requirements.txt

RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY --chown=user app ./app
COPY --chown=user --from=frontend /build/dist ./frontend/dist
RUN mkdir -p /app/data

EXPOSE 7860
CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "7860"]
