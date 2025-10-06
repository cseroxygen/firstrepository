import os, io, time, uuid
from typing import Optional, List, Dict
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body, Query, Response, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
import boto3
from botocore.config import Config
import httpx
from PIL import Image
import pytesseract
import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
    FilterSelector,
)
from openai import OpenAI
from pdfminer.high_level import extract_text as pdf_extract_text, extract_pages
from pdfminer.layout import LTTextContainer
from pdf2image import convert_from_bytes
from langdetect import detect, DetectorFactory
from urllib.parse import urlsplit, urlunsplit

DetectorFactory.seed = 0

APP_NAME = "HomeRef"

MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
MINIO_BUCKET   = os.getenv("MINIO_BUCKET", "homeref-manuals")
MINIO_ACCESS   = os.getenv("MINIO_ROOT_USER", "minio")
MINIO_SECRET   = os.getenv("MINIO_ROOT_PASSWORD", "minio12345")
PUBLIC_MINIO_URL = os.getenv("PUBLIC_MINIO_URL", "http://localhost:9000")

N8N_HOOK       = os.getenv("N8N_INGEST_WEBHOOK_URL", "")

QDRANT_URL        = os.getenv("QDRANT_URL", "http://qdrant:6333")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "manual_chunks")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
EMBED_MODEL    = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
CHAT_MODEL     = os.getenv("CHAT_MODEL", "gpt-4o-mini")
EMBED_BATCH    = int(os.getenv("INGEST_EMBED_BATCH", "64"))

s3 = boto3.client(
    "s3",
    endpoint_url=MINIO_ENDPOINT,
    aws_access_key_id=MINIO_ACCESS,
    aws_secret_access_key=MINIO_SECRET,
    config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    region_name="us-east-1",
)
"""
Separate signer client using PUBLIC_MINIO_URL to ensure the host used for
presigned URLs matches what the browser will call. Changing host after signing
breaks the signature, so sign with the public host up front.
"""
s3_pub = boto3.client(
    "s3",
    endpoint_url=os.getenv("PUBLIC_MINIO_URL", MINIO_ENDPOINT),
    aws_access_key_id=MINIO_ACCESS,
    aws_secret_access_key=MINIO_SECRET,
    config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    region_name="us-east-1",
)
qdrant = QdrantClient(url=QDRANT_URL)
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

app = FastAPI(title=APP_NAME)
JOBS: Dict[str, Dict] = {}
PREVIEW_CACHE: Dict[str, Dict] = {}

# Basic CORS to allow a browser UI in dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True, "app": APP_NAME}


@app.get("/auth/deeplink", response_class=HTMLResponse)
def auth_deeplink(request: Request):
    query = request.url.query
    target = "homeref://auth-callback"
    if query:
        target = f"{target}?{query}"
    html = f"""
    <!doctype html>
    <html>
      <head>
        <meta charset=\"utf-8\" />
        <title>HomeRef</title>
      </head>
      <body style=\"font-family: sans-serif; text-align: center; padding-top: 3rem;\">
        <h2>Opening HomeRef…</h2>
        <p>If nothing happens, please switch back to the app.</p>
        <script>
          window.location.replace(\"{target}\");
        </script>
      </body>
    </html>
    """
    return HTMLResponse(html)

@app.post("/upload")
async def upload(manual_id: str = Form(...), device: Optional[str] = Form(None), namespace: Optional[str] = Form(None), file: UploadFile = File(...)):
    try:
        ts = int(time.time())
        key = f"{manual_id}/{ts}_{file.filename}"
        if namespace:
            key = f"{namespace}/{key}"
        body = await file.read()

        try:
            s3.head_bucket(Bucket=MINIO_BUCKET)
        except Exception:
            s3.create_bucket(Bucket=MINIO_BUCKET)

        s3.put_object(Bucket=MINIO_BUCKET, Key=key, Body=body, ContentType=file.content_type or "application/octet-stream")

        payload = {"bucket": MINIO_BUCKET, "key": key, "manual_id": manual_id, "device": device, "filename": file.filename, "content_type": file.content_type, "namespace": namespace}

        if N8N_HOOK:
            async with httpx.AsyncClient(timeout=30) as client:
                await client.post(N8N_HOOK, json=payload)

        return {"stored": True, "s3": {"bucket": MINIO_BUCKET, "key": key}, "n8n_notified": bool(N8N_HOOK)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def _extract_text_pdf(data: bytes) -> List[Dict]:
    # First try per-page text extraction with pdfminer
    pages: List[Dict] = []
    try:
        bio = io.BytesIO(data)
        page_no = 1
        for layout in extract_pages(bio):
            parts = []
            for element in layout:
                if isinstance(element, LTTextContainer):
                    parts.append(element.get_text())
            pages.append({"page": page_no, "text": "".join(parts)})
            page_no += 1
    except Exception:
        pages = []

    # If pdfminer yields too little text (likely scanned PDF), fallback to OCR per page
    total_chars = sum(len(p.get("text", "")) for p in pages)
    if not pages or total_chars < 50:
        try:
            images = convert_from_bytes(data, dpi=200)
            ocr_pages: List[Dict] = []
            for i, img in enumerate(images, start=1):
                if img.mode != "RGB":
                    img = img.convert("RGB")
                text = pytesseract.image_to_string(img)
                ocr_pages.append({"page": i, "text": text})
            if ocr_pages:
                return ocr_pages
        except Exception:
            pass

    # Fallback: whole-doc single-page text (best effort)
    if not pages:
        try:
            text = pdf_extract_text(io.BytesIO(data)) or ""
        except Exception:
            text = ""
        return [{"page": 1, "text": text}]
    return pages

def _extract_text_image(data: bytes) -> List[Dict]:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    text = pytesseract.image_to_string(img)
    return [{"page": 1, "text": text}]

def _chunk(text: str, page: int, manual_id: str, chunk_chars=1200, overlap=200):
    out, start, idx, n = [], 0, 0, len(text)
    while start < n:
        end = min(n, start + chunk_chars)
        out.append({"page": page, "text": text[start:end], "chunk_index": idx, "manual_id": manual_id})
        idx += 1
        if end == n: break
        start = max(end - overlap, 0)
    return out

def _ensure_collection(vec_size: int):
    try:
        qdrant.get_collection(QDRANT_COLLECTION)
    except Exception:
        qdrant.recreate_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(size=vec_size, distance=Distance.COSINE),
        )

def _embed(texts: List[str]):
    if not openai_client:
        return None
    resp = openai_client.embeddings.create(model=EMBED_MODEL, input=texts)
    return np.vstack([np.array(e.embedding, dtype=np.float32) for e in resp.data])


def _detect_lang(text: str) -> str:
    t = (text or "").strip()
    if len(t) < 20:
        return ""
    try:
        code = detect(t)
        return code or ""
    except Exception:
        return ""

def _ingest_impl(payload: dict, job_id: Optional[str] = None):

    bucket = payload.get("bucket", MINIO_BUCKET)
    key = payload["key"]
    manual_id = payload.get("manual_id", "unknown")
    namespace = payload.get("namespace")
    content_type = (payload.get("content_type") or "").lower()

    obj = s3.get_object(Bucket=bucket, Key=key)
    data = obj["Body"].read()

    if key.lower().endswith(".pdf") or "pdf" in content_type:
        pages = _extract_text_pdf(data)
    elif any(key.lower().endswith(ext) for ext in [".png",".jpg",".jpeg",".webp",".tif",".tiff"]) or "image" in content_type:
        pages = _extract_text_image(data)
    else:
        try: pages = _extract_text_pdf(data)
        except Exception: pages = _extract_text_image(data)

    chunks, extracted_chars = [], 0
    for p in pages:
        extracted_chars += len(p["text"])
        if p["text"].strip():
            chunks.extend(_chunk(p["text"], p["page"], manual_id))

    embedded = upserted = 0
    if openai_client and chunks:
        texts = [c["text"] for c in chunks]
        # Embed and upsert in batches to avoid request size/timeouts
        batch = max(1, min(EMBED_BATCH, 256))
        first_vec_size = None
        for start in range(0, len(texts), batch):
            end = min(len(texts), start + batch)
            sub_chunks = chunks[start:end]
            try:
                vecs = _embed([c["text"] for c in sub_chunks])
            except Exception as e:
                # Skip failed batch but continue; report partial
                continue
            if vecs is None or len(vecs) != len(sub_chunks):
                continue
            if first_vec_size is None:
                first_vec_size = vecs.shape[1]
                _ensure_collection(first_vec_size)
            points = [
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=v.tolist(),
                    payload={
                        "manual_id": manual_id,
                        "namespace": namespace,
                        "page": c["page"],
                        "chunk_index": c["chunk_index"],
                        "s3_key": key,
                        "text": c["text"],
                        "lang": _detect_lang(c["text"]),
                    },
                ) for c, v in zip(sub_chunks, vecs)
            ]
            qdrant.upsert(collection_name=QDRANT_COLLECTION, points=points)
            embedded += len(sub_chunks)
            upserted += len(sub_chunks)
            if job_id and job_id in JOBS:
                JOBS[job_id].update({"state": "running", "embedded": embedded, "upserted": upserted, "chunks": len(chunks)})

    return {"ok": True, "extracted_chars": extracted_chars, "pages": len(pages), "chunks": len(chunks), "embedded": embedded, "upserted": upserted}


@app.post("/ingest")
def ingest(payload: dict = Body(...)):
    return _ingest_impl(payload)


def _run_ingest_job(job_id: str, payload: dict):
    try:
        JOBS[job_id] = {"state": "running", "embedded": 0, "upserted": 0}
        res = _ingest_impl(payload, job_id=job_id)
        JOBS[job_id] = {"state": "done", **res}
    except Exception as e:
        JOBS[job_id] = {"state": "error", "error": str(e)}


@app.post("/ingest/start")
def ingest_start(background_tasks: BackgroundTasks, payload: dict = Body(...)):
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"state": "queued"}
    background_tasks.add_task(_run_ingest_job, job_id, payload)
    return {"job_id": job_id, "state": "queued"}


@app.get("/ingest/status")
def ingest_status(job_id: str = Query(...)):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job



def _retrieve(question: str, manual_id: Optional[str], top_k: int = 5, lang: Optional[str] = None, namespace: Optional[str] = None):
    if not openai_client:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY missing for embedding/search")

    vec = _embed([question])
    if vec is None:
        raise HTTPException(status_code=500, detail="Failed to embed question")

    must = []
    if manual_id:
        must.append(FieldCondition(key="manual_id", match=MatchValue(value=manual_id)))
    if lang:
        must.append(FieldCondition(key="lang", match=MatchValue(value=lang)))
    if namespace:
        must.append(FieldCondition(key="namespace", match=MatchValue(value=namespace)))
    query_filter = Filter(must=must) if must else None

    results = qdrant.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=vec[0].tolist(),
        limit=top_k,
        with_payload=True,
        with_vectors=False,
        query_filter=query_filter,
    )

    contexts = [
        {
            "manual_id": r.payload.get("manual_id"),
            "page": r.payload.get("page"),
            "chunk_index": r.payload.get("chunk_index"),
            "s3_key": r.payload.get("s3_key"),
            "text": r.payload.get("text", ""),
            "score": getattr(r, "score", None),
        }
        for r in results
    ]
    return contexts


@app.post("/query")
def query(payload: dict = Body(...)):
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="'question' is required")
    manual_id = payload.get("manual_id")
    top_k = int(payload.get("top_k", 5))
    lang = (payload.get("lang") or "").strip() or None
    namespace = (payload.get("namespace") or "").strip() or None
    ctx = _retrieve(question, manual_id, top_k, lang, namespace)
    return {"ok": True, "question": question, "contexts": ctx}


@app.post("/chat")
def chat(payload: dict = Body(...)):
    if not openai_client:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY missing for chat")

    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="'question' is required")

    manual_id = payload.get("manual_id")
    top_k = int(payload.get("top_k", 5))
    model = payload.get("model") or CHAT_MODEL

    lang = (payload.get("lang") or "").strip() or None
    namespace = (payload.get("namespace") or "").strip() or None
    contexts = _retrieve(question, manual_id, top_k, lang, namespace)

    context_text = "\n\n".join(
        [f"[manual {c.get('manual_id')}] page {c.get('page')} chunk {c.get('chunk_index')}\n{c.get('text','').strip()}" for c in contexts]
    )

    system_msg = (
        "You are a helpful assistant that answers questions about household product manuals. "
        "Use only the provided context. If the answer is not in the context, say you don't know. "
        "Cite pages when relevant. Be concise and actionable."
    )

    user_msg = (
        f"Question: {question}\n\nContext:\n{context_text if context_text.strip() else '[no context retrieved]'}"
    )

    completion = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.2,
    )

    answer = completion.choices[0].message.content if completion.choices else ""
    return {"ok": True, "answer": answer, "contexts": contexts, "model": model}


@app.get("/manuals")
def list_manuals(namespace: Optional[str] = Query(None)):
    try:
        if namespace:
            resp = s3.list_objects_v2(Bucket=MINIO_BUCKET, Prefix=f"{namespace}/")
        else:
            resp = s3.list_objects_v2(Bucket=MINIO_BUCKET)
    except Exception:
        # Empty bucket or missing; treat as no manuals yet
        return {"manual_ids": []}

    manuals = set()
    for obj in resp.get("Contents", []):
        key = obj.get("Key", "")
        if "/" in key:
            if namespace:
                # Expect keys like namespace/manual_id/...
                parts = key.split("/", 2)
                if len(parts) >= 2 and parts[0] == namespace:
                    manuals.add(parts[1])
            else:
                manuals.add(key.split("/", 1)[0])
    return {"manual_ids": sorted(manuals)}


@app.get("/manuals/{manual_id}/files")
def list_manual_files(manual_id: str, limit: int = Query(100, ge=1, le=1000), namespace: Optional[str] = Query(None)):
    prefix = f"{manual_id}/"
    if namespace:
        prefix = f"{namespace}/{manual_id}/"
    resp = s3.list_objects_v2(Bucket=MINIO_BUCKET, Prefix=prefix)
    files = [o["Key"] for o in resp.get("Contents", [])][:limit]
    return {"manual_id": manual_id, "files": files}


@app.get("/files/url")
def get_file_url(key: str = Query(...), bucket: Optional[str] = Query(None), expires: int = Query(3600, ge=60, le=86400)):
    bkt = bucket or MINIO_BUCKET
    try:
        url = s3_pub.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": bkt, "Key": key},
            ExpiresIn=expires,
        )
        return {"ok": True, "url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/files/preview")
def get_file_preview(
    key: str = Query(...),
    page: int = Query(1, ge=1),
    bucket: Optional[str] = Query(None),
    width: int = Query(1200, ge=200, le=4096),
    dpi: Optional[int] = Query(None, ge=72, le=600),
    bg: str = Query("white"),
):
    """Return a lightweight PNG preview of a manual page.
    For PDFs, renders the requested page; for images, returns the image itself (downscaled).
    The image is generated on the fly and not stored persistently.
    """
    bkt = bucket or MINIO_BUCKET
    try:
        obj = s3.get_object(Bucket=bkt, Key=key)
        data = obj["Body"].read()
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"file not found: {e}")

    # validate bg
    if bg not in ("white", "black", "transparent"):
        bg = "white"

    try:
        cache_key = f"{bkt}:{key}:{page}:{width}:{dpi or 'auto'}:{bg}"
        now = time.time()
        # prune old entries
        if len(PREVIEW_CACHE) > 64:
            for k in list(PREVIEW_CACHE.keys())[:16]:
                PREVIEW_CACHE.pop(k, None)
        if cache_key in PREVIEW_CACHE:
            entry = PREVIEW_CACHE[cache_key]
            if now - entry.get("ts", 0) < 900:
                return Response(content=entry["data"], media_type='image/png')
        png_bytes: Optional[bytes] = None
        kl = key.lower()
        if kl.endswith('.pdf'):
            # Render only requested page for speed
            # Use requested DPI when provided; otherwise infer from width
            _dpi = int(dpi) if dpi else (180 if width and width >= 1200 else 140)
            imgs = convert_from_bytes(data, dpi=_dpi, first_page=page, last_page=page)
            img = imgs[0] if imgs else None
            if img is None:
                raise HTTPException(status_code=400, detail="unable to render page")
            # Composite onto background if needed
            if bg != "transparent":
                if img.mode in ("RGBA", "LA"):
                    base = Image.new("RGBA", img.size, (255, 255, 255, 255) if bg == "white" else (0, 0, 0, 255))
                    base.paste(img, mask=img.split()[-1])
                    img = base.convert("RGB")
                else:
                    img = img.convert("RGB")
            # resize to target width keeping aspect
            w, h = img.size
            if w > 0 and width and w != width:
                nh = int(h * (width / float(w)))
                img = img.resize((width, nh), resample=Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            png_bytes = buf.getvalue()
        elif any(kl.endswith(ext) for ext in ['.png','.jpg','.jpeg','.webp','.tif','.tiff']):
            img = Image.open(io.BytesIO(data))
            if bg != "transparent" and img.mode in ("RGBA", "LA"):
                base = Image.new("RGBA", img.size, (255, 255, 255, 255) if bg == "white" else (0, 0, 0, 255))
                base.paste(img, mask=img.split()[-1])
                img = base.convert("RGB")
            else:
                img = img.convert('RGB')
            w, h = img.size
            if w > width:
                nh = int(h * (width / float(w)))
                img = img.resize((width, nh), resample=Image.LANCZOS)
            buf = io.BytesIO(); img.save(buf, format='PNG'); png_bytes = buf.getvalue()
        else:
            # try PDF path, fallback to raw
            try:
                _dpi = int(dpi) if dpi else 180
                imgs = convert_from_bytes(data, dpi=_dpi)
                img = imgs[0]
                if bg != "transparent":
                    if img.mode in ("RGBA", "LA"):
                        base = Image.new("RGBA", img.size, (255, 255, 255, 255) if bg == "white" else (0, 0, 0, 255))
                        base.paste(img, mask=img.split()[-1])
                        img = base.convert("RGB")
                    else:
                        img = img.convert("RGB")
                buf = io.BytesIO(); img.save(buf, format='PNG'); png_bytes = buf.getvalue()
            except Exception:
                png_bytes = data
        PREVIEW_CACHE[cache_key] = {"ts": now, "data": png_bytes}
        return Response(content=png_bytes, media_type='image/png')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _s3_delete_prefix(prefix: str, bucket: Optional[str] = None) -> int:
    bkt = bucket or MINIO_BUCKET
    deleted = 0
    token = None
    while True:
        if token:
            resp = s3.list_objects_v2(Bucket=bkt, Prefix=prefix, ContinuationToken=token)
        else:
            resp = s3.list_objects_v2(Bucket=bkt, Prefix=prefix)
        contents = resp.get("Contents") or []
        if not contents:
            break
        objs = [{"Key": o["Key"]} for o in contents]
        s3.delete_objects(Bucket=bkt, Delete={"Objects": objs, "Quiet": True})
        deleted += len(objs)
        if resp.get("IsTruncated"):
            token = resp.get("NextContinuationToken")
        else:
            break
    return deleted


@app.delete("/manuals/{manual_id}")
def delete_manual(manual_id: str, bucket: Optional[str] = Query(None), namespace: Optional[str] = Query(None)):
    # Delete files from S3
    prefix = f"{manual_id}/"
    if namespace:
        prefix = f"{namespace}/{manual_id}/"
    files_deleted = _s3_delete_prefix(prefix, bucket)

    # Delete vectors from Qdrant
    try:
        must = [FieldCondition(key="manual_id", match=MatchValue(value=manual_id))]
        if namespace:
            must.append(FieldCondition(key="namespace", match=MatchValue(value=namespace)))
        qdrant.delete(
            collection_name=QDRANT_COLLECTION,
            points_selector=FilterSelector(filter=Filter(must=must)),
            wait=True,
        )
        vectors_deleted = True
    except Exception:
        vectors_deleted = False

    return {"ok": True, "files_deleted": files_deleted, "vectors_deleted": vectors_deleted}


@app.delete("/manuals")
def delete_all(bucket: Optional[str] = Query(None), namespace: Optional[str] = Query(None)):
    # Delete files in bucket (optionally only under namespace)
    bkt = bucket or MINIO_BUCKET
    prefix = f"{namespace}/" if namespace else ""
    total_deleted = _s3_delete_prefix(prefix, bkt)
    # Delete vectors (optionally only under namespace)
    if namespace:
        try:
            qdrant.delete(
                collection_name=QDRANT_COLLECTION,
                points_selector=FilterSelector(filter=Filter(must=[FieldCondition(key="namespace", match=MatchValue(value=namespace))])),
                wait=True,
            )
            vectors_reset = True
        except Exception:
            vectors_reset = False
    else:
        try:
            qdrant.delete_collection(QDRANT_COLLECTION)
            vectors_reset = True
        except Exception:
            vectors_reset = False
    return {"ok": True, "files_deleted": total_deleted, "vectors_reset": vectors_reset}


@app.delete("/manuals/{manual_id}/files")
def delete_file(manual_id: str, key: str = Query(...), bucket: Optional[str] = Query(None), namespace: Optional[str] = Query(None)):
    expected_prefix = f"{manual_id}/"
    if namespace:
        expected_prefix = f"{namespace}/{manual_id}/"
    if not key.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="Key does not belong to manual")
    bkt = bucket or MINIO_BUCKET
    try:
        s3.delete_object(Bucket=bkt, Key=key)
        s3_deleted = True
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        must = [FieldCondition(key="s3_key", match=MatchValue(value=key))]
        if namespace:
            must.append(FieldCondition(key="namespace", match=MatchValue(value=namespace)))
        qdrant.delete(
            collection_name=QDRANT_COLLECTION,
            points_selector=FilterSelector(filter=Filter(must=must)),
            wait=True,
        )
        vectors_deleted = True
    except Exception:
        vectors_deleted = False
    return {"ok": True, "s3_deleted": s3_deleted, "vectors_deleted": vectors_deleted}
