import shutil
import unittest
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app import main
from app.models.schemas import MAX_QUESTION_LENGTH
from app.services import document_service


class RagApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.test_store_dir = Path(__file__).parent / ".test-store"
        shutil.rmtree(self.test_store_dir, ignore_errors=True)
        document_service.STORE_PATH = self.test_store_dir / "documents.json"
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        self.client.close()
        shutil.rmtree(self.test_store_dir, ignore_errors=True)

    def test_ingested_document_is_persisted_and_retrieved_with_citation(self) -> None:
        response = self.client.post(
            "/rag/ingest",
            files={
                "file": (
                    "clinic-policy.txt",
                    b"Clinic policy: appointments require a referral letter before booking.",
                    "text/plain",
                )
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["chunks_indexed"], 1)
        self.assertTrue(document_service.STORE_PATH.exists())

        result = self.client.post(
            "/rag/query",
            json={"question": "What is required before booking an appointment?"},
        )
        body = result.json()
        self.assertEqual(result.status_code, 200)
        self.assertFalse(body["insufficient_context"])
        self.assertIn("referral letter", body["answer"])
        self.assertEqual(body["sources"][0]["filename"], "clinic-policy.txt")
        self.assertEqual(body["sources"][0]["chunk"], 1)
        self.assertTrue(body["sources"][0]["excerpt"])

    def test_irrelevant_query_reports_insufficient_context(self) -> None:
        self.client.post(
            "/rag/ingest",
            files={"file": ("policy.md", "# Billing\nInvoices are sent monthly.", "text/markdown")},
        )

        result = self.client.post(
            "/rag/query", json={"question": "How does photosynthesis work?"}
        )
        body = result.json()
        self.assertEqual(result.status_code, 200)
        self.assertTrue(body["insufficient_context"])
        self.assertEqual(body["sources"], [])
        self.assertTrue("couldn't find" in body["answer"].lower() or "no answer can be grounded" in body["answer"].lower())

    def test_reingesting_filename_replaces_document(self) -> None:
        self.client.post(
            "/rag/ingest",
            files={"file": ("guide.txt", b"Old content about invoices.", "text/plain")},
        )
        replaced = self.client.post(
            "/rag/ingest",
            files={"file": ("guide.txt", b"New content about referrals.", "text/plain")},
        )
        self.assertTrue(replaced.json()["replaced_existing"])
        listed = self.client.get("/rag/documents").json()["documents"]
        self.assertEqual(len(listed), 1)

        result = self.client.post(
            "/rag/query", json={"question": "What does the guide say about referrals?"}
        )
        self.assertTrue("referral" in result.json()["answer"].lower())

    def test_ingestion_and_query_limits_are_enforced(self) -> None:
        unsupported = self.client.post(
            "/rag/ingest",
            files={"file": ("notes.csv", b"a,b", "text/csv")},
        )
        self.assertEqual(unsupported.status_code, 400)

        too_large = self.client.post(
            "/rag/ingest",
            files={
                "file": (
                    "large.txt",
                    b"x" * (document_service.MAX_UPLOAD_BYTES + 1),
                    "text/plain",
                )
            },
        )
        self.assertEqual(too_large.status_code, 413)

        invalid_query = self.client.post(
            "/rag/query", json={"question": "x" * (MAX_QUESTION_LENGTH + 1)}
        )
        self.assertEqual(invalid_query.status_code, 422)

    def test_existing_health_and_prescription_routes_remain_available(self) -> None:
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["service"], "ai")
        self.assertTrue(health.json()["ok"])

        pdf = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=72, height=72)
        writer.write(pdf)
        extracted = self.client.post(
            "/extract-prescription",
            files={"file": ("prescription.pdf", pdf.getvalue(), "application/pdf")},
        )
        self.assertEqual(extracted.status_code, 200, extracted.text)
        self.assertEqual(extracted.json()["filename"], "prescription.pdf")
        self.assertEqual(extracted.json()["pages"], 1)
        self.assertIn("text", extracted.json())


if __name__ == "__main__":
    unittest.main()
