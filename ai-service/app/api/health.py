from fastapi import APIRouter

from app.services import document_service

router = APIRouter()


@router.get("/health")
def health() -> dict[str, object]:
    count = len(document_service.load_documents())
    return {"ok": True, "service": "ai", "indexed_documents": count}