# ClinicQueue AI service

This FastAPI service provides PDF prescription text extraction and local,
document-grounded retrieval. Retrieval is deterministic and runs without a
model provider, network access, or paid credentials. It returns source excerpts
instead of attempting to interpret them as clinical advice.

## Run locally

From this directory, install `requirements.txt` and run:

```sh
uvicorn app.main:app --reload
```

By default, uploaded documents are chunked and stored in
`ai-service/data/documents.json`. Set `CLINICQUEUE_RAG_STORE` to use a different
JSON index path. The index persists across service restarts; re-uploading a
filename replaces its previous indexed contents.

## Retrieval API

`POST /rag/ingest` accepts multipart form data with a `file` in PDF, UTF-8
plain text, or Markdown format. Uploads are limited to 10 MiB. `GET
/rag/documents` lists indexed file metadata.

`POST /rag/query` accepts JSON such as:

```json
{"question": "What is required before booking?", "top_k": 4}
```

Questions are limited to 1,000 characters and `top_k` to 1–8. Answers consist
of ranked verbatim passages; each source identifies its filename, document
ID, chunk number, excerpt, and lexical relevance score. If no passage meets
the relevance threshold, the response explicitly reports insufficient context
and returns no sources. This lexical retriever does not generate or infer
clinical recommendations.

`POST /extract-prescription` remains available for PDF text extraction and is
also limited to 10 MiB per request.
