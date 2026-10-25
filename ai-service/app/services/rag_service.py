from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

from app.services import document_service

CHUNK_WORDS = 300
CHUNK_OVERLAP_WORDS = 60
MIN_RELEVANCE_SCORE = 0.25
TOKEN_PATTERN = re.compile(r"[a-z0-9]+", re.IGNORECASE)
STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
    "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to",
    "was", "what", "when", "where", "which", "with",
}


def tokens(text: str) -> list[str]:
    return [
        token.lower()
        for token in TOKEN_PATTERN.findall(text)
        if token.lower() not in STOP_WORDS
    ]


def split_chunks(text: str) -> list[str]:
    words = text.split()
    if not words:
        return []
    chunks = []
    step = CHUNK_WORDS - CHUNK_OVERLAP_WORDS
    for start in range(0, len(words), step):
        chunk = " ".join(words[start : start + CHUNK_WORDS]).strip()
        if chunk:
            chunks.append(chunk)
        if start + CHUNK_WORDS >= len(words):
            break
    return chunks


def rank_chunks(
    documents: list[dict[str, Any]], query_tokens: list[str], top_k: int
) -> list[dict[str, Any]]:
    entries = []
    for document in documents:
        for index, text in enumerate(document.get("chunks", []), start=1):
            chunk_tokens = tokens(text)
            if chunk_tokens:
                entries.append(
                    {
                        "document": document,
                        "chunk_number": index,
                        "text": text,
                        "tokens": chunk_tokens,
                        "frequency": Counter(chunk_tokens),
                    }
                )
    if not entries:
        return []

    total_documents = len(entries)
    average_length = sum(len(entry["tokens"]) for entry in entries) / total_documents
    document_frequency = {
        term: sum(term in entry["frequency"] for entry in entries)
        for term in set(query_tokens)
    }
    query_terms = set(query_tokens)
    ranked = []
    for entry in entries:
        matched_terms = query_terms.intersection(entry["frequency"])
        if not matched_terms:
            continue
        score = 0.0
        length = len(entry["tokens"])
        for term in matched_terms:
            frequency = entry["frequency"][term]
            df = document_frequency[term]
            inverse_frequency = math.log(
                1 + (total_documents - df + 0.5) / (df + 0.5)
            )
            score += inverse_frequency * (
                frequency * 2.2
                / (frequency + 1.2 * (0.25 + 0.75 * length / average_length))
            )
        coverage = len(matched_terms) / len(query_terms)
        if score >= MIN_RELEVANCE_SCORE and coverage >= 0.25:
            ranked.append((score, entry))
    ranked.sort(key=lambda result: result[0], reverse=True)
    return [
        {
            "filename": entry["document"]["filename"],
            "document_id": entry["document"]["id"],
            "chunk": entry["chunk_number"],
            "excerpt": entry["text"],
            "relevance": round(score, 4),
        }
        for score, entry in ranked[:top_k]
    ]


import os
import requests

def query_documents(question: str, top_k: int) -> dict[str, Any]:
    query_tokens = tokens(question)
    documents = document_service.load_documents()
    sources = rank_chunks(documents, query_tokens, top_k)
    if not sources:
        answer = (
            "I couldn't find this information in the clinic's uploaded records. "
            "Please contact our reception desk or ask clinic staff."
        )
        return {
            "answer": answer,
            "question": question,
            "sources": [],
            "insufficient_context": True,
        }

    context_text = "\n\n".join(
        f"[Section {index}] {source['excerpt']}"
        for index, source in enumerate(sources, start=1)
    )

    groq_api_key = os.environ.get("GROQ_API_KEY")
    if groq_api_key:
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {groq_api_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": "openai/gpt-oss-20b",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are the official AI assistant for ClinicQueue Medical Center. "
                            "Provide a PROPERLY FORMATTED, CONCISE, and RELEVANT response based strictly on the provided clinic documentation context.\n\n"
                            "Formatting Rules:\n"
                            "1. Use clean bullet points (•) and bold titles for clarity. Avoid long paragraphs.\n"
                            "2. Add relevant emojis (📍 for location, ⏰ for timings, 👨‍⚕️ for doctors, 💳 for fees, 📞 for contact/emergency).\n"
                            "3. For Location questions: Give ONLY the hospital address, landmark, and parking/metro access. Keep it to 3-4 bullet points.\n"
                            "4. For Doctor questions: Give the doctor's name, specialization, consultation timings, fee, and room/cabin.\n"
                            "5. For Timings or Fees: List them cleanly with bullet points.\n"
                            "6. Never dump entire documentation chapters. Be direct, clear, and easy to read on mobile."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"Clinic Documentation:\n{context_text}\n\nPatient Question: {question}\n\nStructured Answer:",
                    },
                ],
                "temperature": 0.1,
                "max_tokens": 600,
            }
            response = requests.post(url, json=payload, headers=headers, timeout=25, verify=False)
            if response.status_code == 200:
                answer = response.json()["choices"][0]["message"]["content"].strip()
                return {
                    "answer": answer,
                    "question": question,
                    "sources": sources,
                    "insufficient_context": False,
                }
        except Exception as e:
            print(f"Groq RAG synthesis fallback: {e}")

    # Clean fallback: extract key relevant lines without header clutter
    clean_lines = []
    for source in sources[:2]:
        text = source.get("excerpt", "")
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("---"):
                continue
            if line.startswith("-") or line.startswith("•") or ":" in line:
                if len(line) > 10 and line not in clean_lines:
                    clean_lines.append(line)
            if len(clean_lines) >= 6:
                break
        if len(clean_lines) >= 6:
            break

    if clean_lines:
        answer = "📋 **Clinic Information**\n\n" + "\n".join(
            line if line.startswith("•") or line.startswith("-") else f"• {line}"
            for line in clean_lines[:6]
        )
    else:
        answer = "I couldn't find specific details for that in clinic records. Please check with our reception desk."

    return {
        "answer": answer,
        "question": question,
        "sources": sources,
        "insufficient_context": False,
    }