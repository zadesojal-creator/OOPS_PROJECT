from pydantic import BaseModel, Field

MAX_QUESTION_LENGTH = 1000
MAX_TOP_K = 8


class QueryPayload(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_QUESTION_LENGTH)
    top_k: int = Field(default=4, ge=1, le=MAX_TOP_K)