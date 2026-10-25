from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pypdf import PdfReader

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
SUPPORTED_TYPES = {
    ".txt": {"text/plain", "application/octet-stream"},
    ".md": {"text/markdown", "text/plain", "application/octet-stream"},
    ".pdf": {"application/pdf"},
}
STORE_PATH = Path(
    os.environ.get(
        "CLINICQUEUE_RAG_STORE",
        str(Path(__file__).resolve().parents[2] / "data" / "documents.json"),
    )
).expanduser()
_store_lock = threading.RLock()


def _load_documents() -> list[dict[str, Any]]:
    if not STORE_PATH.exists():
        return []
    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        documents = data.get("documents", [])
        if isinstance(documents, list):
            return documents
    except (OSError, json.JSONDecodeError):
        pass
    raise HTTPException(500, "The local document index is unreadable.")


def load_documents() -> list[dict[str, Any]]:
    with _store_lock:
        return _load_documents()


def _save_documents(documents: list[dict[str, Any]]) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = STORE_PATH.with_name(f"{STORE_PATH.name}.tmp")
    try:
        temporary_path.write_text(
            json.dumps({"documents": documents}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary_path.replace(STORE_PATH)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def extract_text(extension: str, content: bytes) -> str:
    if extension == ".pdf":
        try:
            reader = PdfReader(BytesIO(content))
            if reader.is_encrypted:
                raise HTTPException(400, "Encrypted PDFs are not supported.")
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, "The PDF could not be read.") from exc
    else:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise HTTPException(400, "Text documents must use UTF-8 encoding.") from exc
    text = text.strip()
    if not text:
        raise HTTPException(400, "The document contains no extractable text.")
    return text


def store_document(filename: str, content: bytes, chunks: list[str]) -> tuple[dict[str, Any], bool]:
    document_id = hashlib.sha256(filename.encode("utf-8") + b"\0" + content).hexdigest()[:16]
    document = {
        "id": document_id,
        "filename": filename,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "chunks": chunks,
    }
    with _store_lock:
        documents = _load_documents()
        replaced_existing = any(item.get("filename") == filename for item in documents)
        documents = [item for item in documents if item.get("filename") != filename]
        documents.append(document)
        _save_documents(documents)
    return document, replaced_existing