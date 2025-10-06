# HomeRef (iOS-only)

A trimmed workspace with only the iOS mobile app, backend API, and required services (MinIO + Qdrant). Web and n8n/postgres are removed.

## Contents
- apps/
  - mobile/ (Expo + React Native)
  - api/ (FastAPI)
- infra/
  - docker-compose.yml (api + minio + qdrant)
- .env (copied from original, with n8n webhook disabled)

## Run
1) Start backend services:

```sh
cd infra
docker compose up -d --build
```

2) Launch the iOS app (Simulator):

```sh
cd ../apps/mobile
npm install
npm run ios
```

The app talks to the API at http://localhost:8000 by default.

## Services
- API: http://localhost:8000/health
- MinIO Console: http://localhost:9001 (MINIO_ROOT_USER/MINIO_ROOT_PASSWORD from .env)
- Qdrant: http://localhost:6333

## Notes
- The .env is copied as-is (API keys preserved). In this copy, `N8N_INGEST_WEBHOOK_URL` is set blank, since n8n is not part of this stack.
- Postgres and n8n were removed; they aren’t required for the current flows.
- If using a real device, set `api_base` in AsyncStorage to your Mac’s LAN IP (e.g., http://192.168.x.x:8000).
HomeRef – Manuals Ingestion + RAG API

Overview
- FastAPI service to upload manuals, extract text (PDF/OCR), embed, and store in Qdrant.
- MinIO (S3) stores the raw files. Qdrant stores vectors + text chunks.
- n8n receives a webhook after upload and can call API ingestion.
- New endpoints: `/query` for retrieval and `/chat` for RAG chat answers.

Stack
- API: FastAPI (Python 3.11), Uvicorn
- Storage: MinIO (S3 compatible)
- Vector DB: Qdrant
- Automation: n8n

Quick Start
1) Prereqs: Docker + Docker Compose, an OpenAI API key.
2) Configure env: edit `.env` at repo root and set `OPENAI_API_KEY` (and adjust others if needed).
3) Start services:
   cd infra
   docker compose up -d --build

4) Verify API health:
   curl http://localhost:8000/health

5) Upload a manual (PDF or image). This saves to MinIO and notifies n8n:
   curl -F "manual_id=my-tv" -F "file=@/path/to/file.pdf" http://localhost:8000/upload

6) Ingest the file: Either let n8n call `/ingest` (recommended), or call directly:
   curl -X POST http://localhost:8000/ingest \
     -H 'Content-Type: application/json' \
     -d '{"bucket":"homeref-manuals","key":"my-tv/1699999999_file.pdf","manual_id":"my-tv","content_type":"application/pdf"}'

7) Ask questions:
   curl -X POST http://localhost:8000/query \
     -H 'Content-Type: application/json' \
     -d '{"question":"How to change input?","manual_id":"my-tv","top_k":5}'

   curl -X POST http://localhost:8000/chat \
     -H 'Content-Type: application/json' \
     -d '{"question":"How to change input?","manual_id":"my-tv"}'

Endpoints
- GET `/health`: basic health check
- POST `/upload` (multipart): `manual_id`, optional `device`, and `file` (pdf/image). Saves to MinIO and notifies n8n via `N8N_INGEST_WEBHOOK_URL`.
- POST `/ingest` (JSON): `bucket`, `key`, `manual_id`, `content_type` – pulls file from MinIO, extracts text (PDFMiner per-page for PDFs, or Tesseract OCR for images), chunks, embeds, and upserts into Qdrant. Payload stores text for RAG.
- POST `/query` (JSON): `question`, optional `manual_id`, `top_k` – returns nearest chunks from Qdrant.
- POST `/chat` (JSON): `question`, optional `manual_id`, `top_k`, optional `model` – RAG answer via OpenAI chat completions.
- GET `/manuals`: list discovered `manual_id`s from bucket keys.
- GET `/manuals/{manual_id}/files`: list stored files under a manual id.

n8n Setup
- A backup is included under `infra/` (e.g. `n8n_backup_*.tgz`). You can restore by stopping the `n8n` container, extracting into the `n8n_data` volume path, or by using n8n’s import UI. At minimum, create a webhook workflow at `/webhook/ingest` that POSTs to `http://api:8000/ingest` with the JSON from `/upload`.

Development in VS Code
- Use this repo directly. The API auto-reloads are not enabled in the container; for local iteration you can run API outside Docker if you prefer:
   pip install -r apps/api/requirements.txt
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --app-dir apps/api

- For Docker-based dev, rebuild API when you change dependencies:
   docker compose -f infra/docker-compose.yml build api && docker compose -f infra/docker-compose.yml up -d api

Notes
- Ensure `OPENAI_API_KEY` is set; embeddings and chat require it.
- Tesseract OCR is installed in the API image for images (PNG/JPG/etc.).
- Qdrant payload now stores the chunk `text` to support RAG responses.

Next Steps
- Add a simple web UI (upload + chat) and call API endpoints from the browser (CORS is enabled).
- Add auth for uploads and chat.
- Add PDF page indexing for accurate page numbers when extracting multi-page PDFs.
