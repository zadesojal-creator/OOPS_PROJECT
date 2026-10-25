from fastapi import FastAPI
from dotenv import load_dotenv
load_dotenv()

from app.api.health import router as health_router
from app.api.prescription import router as prescription_router
from app.api.rag import router as rag_router
from app.api.nlp import router as nlp_router

app = FastAPI(title="ClinicQueue AI Service", version="1.0.0")
app.include_router(health_router)
app.include_router(prescription_router)
app.include_router(rag_router)
app.include_router(nlp_router, prefix="/nlp")
