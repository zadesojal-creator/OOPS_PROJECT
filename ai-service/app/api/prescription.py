from __future__ import annotations

from io import BytesIO
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pypdf import PdfReader

from app.services.document_service import MAX_UPLOAD_BYTES

router = APIRouter()


@router.post("/extract-prescription")
async def extract_prescription(file: UploadFile = File(...)) -> dict[str, Any]:
    if file.content_type != "application/pdf":
        raise HTTPException(400, "PDF required")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the 10 MB upload limit.")
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted:
            raise HTTPException(400, "Encrypted PDFs are not supported.")
        text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, "The PDF could not be read.") from exc
    return {
        "filename": file.filename,
        "pages": len(reader.pages),
        "text": text,
        "confidence": "document-text-extraction",
    }