from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models.schemas import MAX_QUESTION_LENGTH, QueryPayload
from app.services import document_service, rag_service

router = APIRouter()


@router.post("/rag/ingest")
async def ingest_document(file: UploadFile = File(...)) -> dict[str, Any]:
    filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    extension = Path(filename).suffix.lower()
    if not filename or extension not in document_service.SUPPORTED_TYPES:
        raise HTTPException(400, "Upload a .txt, .md, or .pdf document.")
    if file.content_type not in document_service.SUPPORTED_TYPES[extension]:
        raise HTTPException(400, f"Unsupported content type for {extension} documents.")

    content = await file.read(document_service.MAX_UPLOAD_BYTES + 1)
    if len(content) > document_service.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the 10 MB upload limit.")
    text = document_service.extract_text(extension, content)
    chunks = rag_service.split_chunks(text)
    if not chunks:
        raise HTTPException(400, "The document contains no indexable text.")
    document, replaced_existing = document_service.store_document(filename, content, chunks)
    return {
        "document_id": document["id"],
        "filename": filename,
        "chunks_indexed": len(chunks),
        "replaced_existing": replaced_existing,
    }


@router.get("/rag/documents")
def list_documents() -> dict[str, Any]:
    documents = document_service.load_documents()
    return {
        "documents": [
            {
                "document_id": item["id"],
                "filename": item["filename"],
                "uploaded_at": item["uploaded_at"],
                "chunks_indexed": len(item.get("chunks", [])),
            }
            for item in documents
        ]
    }


@router.post("/rag/query")
def rag_query(payload: QueryPayload) -> dict[str, Any]:
    question = payload.question.strip()
    if not question:
        raise HTTPException(400, "question is required")
    if len(question) > MAX_QUESTION_LENGTH:
        raise HTTPException(400, "question must be at most 1000 characters")
    return rag_service.query_documents(question, payload.top_k)