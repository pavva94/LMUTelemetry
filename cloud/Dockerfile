FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIST=/app/frontend/dist
WORKDIR /app
COPY cloud/requirements.txt /app/cloud/requirements.txt
RUN pip install --no-cache-dir -r /app/cloud/requirements.txt
COPY cloud /app/cloud
COPY --from=frontend /src/frontend/dist /app/frontend/dist
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app
USER app
CMD ["sh", "-c", "uvicorn cloud.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-server-header"]

