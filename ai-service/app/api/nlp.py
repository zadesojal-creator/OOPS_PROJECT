import os
import re
import json
import requests
from typing import Optional, Dict, Any, List
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()

VALID_SPECIALIZATIONS = [
    "Cardiologist",
    "Dermatologist",
    "Neurologist",
    "Orthopedic",
    "Pediatrician",
    "General Physician",
    "ENT",
    "Dentist"
]

EMERGENCY_PATTERNS = [
    r"\b(chest\s+pain|heart\s+attack|angina)\b",
    r"\b(shortness\s+of\s+breath|can['’]?t\s+breathe|cannot\s+breathe|difficulty\s+breathing|breathless)\b",
    r"\b(unconscious|passed\s+out|fainted|loss\s+of\s+consciousness)\b",
    r"\b(stroke|paralysis|facial\s+droop|slurred\s+speech)\b",
    r"\b(severe\s+bleeding|coughing\s+blood|vomiting\s+blood)\b",
    r"\b(choking|seizure|convulsion|head\s+trauma)\b",
    r"\b(emergency|urgent\s+care|call\s+ambulance)\b"
]

GREETING_PATTERNS = [
    r"^(hi|hello|hey|good\s+morning|good\s+afternoon|good\s+evening|greetings|howdy|namaste)\b",
    r"\b(can\s+you\s+help\s+me|help\s+me\s+please)\b"
]

THANKS_PATTERNS = [
    r"\b(thank\s+you|thanks|thx|thankyou|appreciate\s+it|grateful)\b"
]

GOODBYE_PATTERNS = [
    r"\b(bye|goodbye|see\s+you|take\s+care|cya|farewell)\b"
]

TIMING_PATTERNS = [
    r"\b(timing|timings|opening\s+hours|open\s+hours|closing\s+time|when\s+do\s+you\s+open|what\s+time\s+do\s+you\s+open|is\s+the\s+clinic\s+open|is\s+the\s+hospital\s+open|open\s+on\s+sunday|sunday\s+opd|opd\s+hours|when\s+can\s+i\s+consult|consultation\s+timings?|consultation\s+hours?|doctor\s+timings?)\b"
]

FEE_PATTERNS = [
    r"\b(fee|fees|cost|costs|charge|charges|price|pricing|tariff|rate|how\s+much\s+does\s+it\s+cost|consultation\s+charge|payment\s+modes|insurance)\b"
]

LOCATION_PATTERNS = [
    r"\b(where\s+are\s+you|where\s+is\s+the\s+clinic|hospital\s+location|address|landmark|parking|directions|how\s+to\s+reach)\b"
]

DOCTOR_INFO_PATTERNS = [
    r"\b(available\s+doctors|list\s+of\s+doctors|doctors?\s+list|show\s+doctors?|our\s+doctors|who\s+are\s+(the|your)\s+doctors|doctors?\s+available|doctor\s+details|physicians|specialists(\s+available)?|what\s+doctors|tell\s+me\s+about\s+(your\s+)?doctors)\b",
    r"\b(who\s+is\s+the|which)\s+(doctor|specialist|physician)\b"
]

APPOINTMENT_REQUEST_PATTERNS = [
    r"\b(book\s+an?\s+appointment|need\s+an?\s+appointment|schedule\s+an?\s+appointment|want\s+to\s+see\s+a?\s+doctor|meet\s+the\s+doctor|consult\s+a?\s+doctor|take\s+an?\s+appointment|make\s+an?\s+appointment)\b"
]

STATUS_PATTERNS = [
    r"\b(check\s+status|token\s+status|appointment\s+status|my\s+token|queue\s+status|my\s+position|line\s+position)\b"
]

CANCEL_PATTERNS = [
    r"\b(cancel\s+token|cancel\s+my\s+token|cancel\s+appointment|cancel\s+my\s+appointment|delete\s+appointment)\b"
]

REGISTRATION_PATTERNS = [
    r"\b(register\s+patient|register\s+a\s+new\s+patient|new\s+registration|add\s+family\s+member|register\s+my\s+(mother|father|child|son|daughter|wife|husband))\b"
]

class NlpRequest(BaseModel):
    text: Optional[str] = None
    query: Optional[str] = None

    def get_raw_text(self) -> str:
        return (self.text or self.query or "").strip()

class IntentResponse(BaseModel):
    intent: str
    confidence: float
    specialization: Optional[str] = None
    is_emergency: bool = False
    entities: Dict[str, Any] = Field(default_factory=dict)
    polite_response: Optional[str] = None

def check_emergency(text: str) -> bool:
    lowered = text.lower()
    for pattern in EMERGENCY_PATTERNS:
        if re.search(pattern, lowered):
            return True
    return False

def fallback_specialization_matcher(text: str) -> Optional[str]:
    lowered = text.lower()
    
    # 1. Cardiology
    if re.search(r"\b(heart\w*|cardio\w*|chest\s+tightness|palpitat\w*|hypertension|blood\s+pressure|bp|ecg|angio\w*)\b", lowered):
        return "Cardiologist"
    # 2. Dermatology
    if re.search(r"\b(skin\w*|derma\w*|dermatolog\w*|rash\w*|acne|eczema|psoriasis|allerg\w*|hair\s+loss|dandruff|mole\w*|cosmetolog\w*|pigmentation)\b", lowered):
        return "Dermatologist"
    # 3. Pediatrics
    if re.search(r"\b(child\w*|pediatric\w*|baby|newborn|infant\w*|toddler\w*|vaccinat\w*|immunizat\w*|kid\w*)\b", lowered):
        return "Pediatrician"
    # 4. Neurology
    if re.search(r"\b(brain\w*|neuro\w*|migraine\w*|headache\w*|seizure\w*|epilep\w*|paralysis|nerve\w*|neuropath\w*|tremor\w*|dizziness|vertigo)\b", lowered):
        return "Neurologist"
    # 5. Orthopedics
    if re.search(r"\b(bone\w*|ortho\w*|joint\w*|knee\w*|fracture\w*|back\s+pain|spine\w*|arthrit\w*|ligament\w*|sprain\w*|sciatica|neck\s+pain)\b", lowered):
        return "Orthopedic"
    # 6. ENT
    if re.search(r"\b(ear\w*|nose\w*|throat\w*|ent\b|hearing|sinus\w*|tonsil\w*|voice|earache|snoring)\b", lowered):
        return "ENT"
    # 7. Dentist
    if re.search(r"\b(tooth|teeth|dent\w*|cavity|cavities|gum\w*|root\s+canal|braces|jaw\s+pain)\b", lowered):
        return "Dentist"
    # 8. General Physician
    if re.search(r"\b(fever\w*|flu\b|cough\w*|cold\b|infection\w*|weakness|fatigue|nausea|vomit\w*|stomach\w*|diabetes|checkup\w*|general\s+doctor|physician\w*)\b", lowered):
        return "General Physician"
    
    return None

def fallback_intent_classifier(text: str) -> IntentResponse:
    lowered = text.lower()

    # Emergency takes absolute precedence
    if check_emergency(lowered):
        spec = fallback_specialization_matcher(lowered) or "Cardiologist"
        return IntentResponse(
            intent="emergency",
            confidence=0.99,
            specialization=spec,
            is_emergency=True,
            entities={"urgency": "critical"}
        )

    # Cancel
    for p in CANCEL_PATTERNS:
        if re.search(p, lowered):
            return IntentResponse(intent="appointment_cancellation", confidence=0.95, is_emergency=False)

    # Status
    for p in STATUS_PATTERNS:
        if re.search(p, lowered):
            return IntentResponse(intent="appointment_status", confidence=0.95, is_emergency=False)

    # Registration
    for p in REGISTRATION_PATTERNS:
        if re.search(p, lowered):
            return IntentResponse(intent="patient_registration", confidence=0.95, is_emergency=False)

    # Appointment Request
    for p in APPOINTMENT_REQUEST_PATTERNS:
        if re.search(p, lowered):
            spec = fallback_specialization_matcher(lowered)
            return IntentResponse(intent="appointment_request", confidence=0.95, specialization=spec, is_emergency=False)

    # Greetings
    for p in GREETING_PATTERNS:
        if re.search(p, lowered):
            return IntentResponse(intent="greeting", confidence=0.95, is_emergency=False)

    # Thanks
    for p in THANKS_PATTERNS:
        if re.search(p, lowered):
            return IntentResponse(intent="thanks", confidence=0.95, is_emergency=False)

    # Goodbye
    for p in GOODBYE_PATTERNS:
        if re.search(p, lowered):
            return IntentResponse(intent="goodbye", confidence=0.95, is_emergency=False)

    # Timings
    for p in TIMING_PATTERNS:
        if re.search(p, lowered):
            return IntentResponse(intent="hospital_timings", confidence=0.92, is_emergency=False)

    # Fees
    for p in FEE_PATTERNS:
        if re.search(p, lowered):
            spec = fallback_specialization_matcher(lowered)
            return IntentResponse(intent="consultation_fees", confidence=0.92, specialization=spec, is_emergency=False)

    # Location / Address
    for p in LOCATION_PATTERNS:
        if re.search(p, lowered):
            return IntentResponse(intent="hospital_info", confidence=0.92, is_emergency=False)

    # Doctor Info
    for p in DOCTOR_INFO_PATTERNS:
        if re.search(p, lowered):
            spec = fallback_specialization_matcher(lowered)
            return IntentResponse(intent="doctor_info", confidence=0.90, specialization=spec, is_emergency=False)

    # Symptom description
    spec = fallback_specialization_matcher(lowered)
    if spec:
        return IntentResponse(intent="symptom_description", confidence=0.88, specialization=spec, is_emergency=False)

    # Hospital general query
    if "clinic" in lowered or "hospital" in lowered or "facility" in lowered:
        return IntentResponse(intent="hospital_info", confidence=0.80, is_emergency=False)

    # Default to clarification if too short or unclear
    return IntentResponse(intent="clarification_required", confidence=0.50, is_emergency=False)

def call_groq_intent_classifier(text: str) -> Optional[IntentResponse]:
    groq_api_key = os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        return None

    models_to_try = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.1-8b-instant"]

    system_prompt = (
        "You are an expert clinical triage and natural-language intent router for ClinicQueue Medical Center.\n"
        "Analyze the user message and output strictly valid JSON with no markdown wrapping or preamble.\n\n"
        "Allowed Intents:\n"
        "- emergency: Severe acute symptoms (chest pain, stroke, breathlessness, heavy bleeding, seizure).\n"
        "- greeting: Casual hellos, polite greetings, 'can you help me'.\n"
        "- thanks: Expressions of gratitude, 'thank you', 'thanks'.\n"
        "- goodbye: Farewells, 'bye', 'take care'.\n"
        "- hospital_timings: Questions regarding clinic opening hours, OPD hours, Sunday schedule.\n"
        "- consultation_fees: Questions about pricing, doctor charges, consultation fees, payment modes.\n"
        "- hospital_info: Questions about hospital address, location, departments, contact numbers, parking.\n"
        "- doctor_info: Questions asking who the available doctors or specialists are.\n"
        "- symptom_description: Patient describes a non-emergency health complaint or symptom.\n"
        "- appointment_request: User wants to book or schedule a visit.\n"
        "- appointment_status: User asks about their live token, line position, or upcoming visit status.\n"
        "- appointment_cancellation: User asks to cancel a token or appointment.\n"
        "- patient_registration: User wants to register a new patient or family member.\n"
        "- clarification_required: Message is completely ambiguous, incomplete, or gibberish.\n\n"
        "Allowed Specializations (or null):\n"
        "Cardiologist, Dermatologist, Neurologist, Orthopedic, Pediatrician, General Physician, ENT, Dentist.\n\n"
        "Output JSON Format:\n"
        "{\"intent\": \"...\", \"specialization\": \"...\" or null, \"is_emergency\": true/false, \"confidence\": 0.95}"
    )

    for model in models_to_try:
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {groq_api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": text}
                ],
                "temperature": 0.0,
                "max_tokens": 120
            }
            # verify=False is used to prevent SSL failure on localized Windows environments without root cert sync
            response = requests.post(url, json=payload, headers=headers, timeout=8, verify=False)
            if response.status_code == 200:
                raw_content = response.json()["choices"][0]["message"]["content"].strip()
                # Clean any markdown code fences if model enclosed in ```json
                clean_json = re.sub(r"^```(?:json)?\s*", "", raw_content)
                clean_json = re.sub(r"\s*```$", "", clean_json)
                data = json.loads(clean_json)

                intent = data.get("intent", "clarification_required")
                lowered_text = text.lower()

                # Disambiguate doctor_info vs hospital_info
                if intent == "hospital_info" and re.search(r"\b(doctor\w*|physician\w*|specialist\w*)\b", lowered_text):
                    intent = "doctor_info"

                spec = data.get("specialization")
                if spec and spec not in VALID_SPECIALIZATIONS:
                    for v in VALID_SPECIALIZATIONS:
                        if v.lower() in str(spec).lower():
                            spec = v
                            break
                    else:
                        spec = None

                is_emer = bool(data.get("is_emergency", False)) or check_emergency(text)
                conf = float(data.get("confidence", 0.9))

                return IntentResponse(
                    intent=intent,
                    confidence=conf,
                    specialization=spec,
                    is_emergency=is_emer
                )
        except Exception as e:
            # Continue to next model or fallback
            continue

    return None

@router.post("/specialization")
async def match_specialization(req: NlpRequest):
    """
    Backward-compatible specialization matcher.
    Preserves existing contract {"specialization": "..."} while avoiding false positive
    General Physician matches for greetings and non-medical FAQs.
    """
    raw_text = req.get_raw_text()
    if not raw_text:
        return {"specialization": "General Physician"}

    lowered = raw_text.lower()

    # Pre-check: Emergency
    if check_emergency(lowered):
        spec = fallback_specialization_matcher(lowered) or "Cardiologist"
        return {"specialization": spec, "is_emergency": True}

    # Pre-check: Non-medical greetings, timings, fees should NOT be forced to General Physician
    for p in GREETING_PATTERNS + TIMING_PATTERNS + FEE_PATTERNS + LOCATION_PATTERNS + THANKS_PATTERNS + GOODBYE_PATTERNS:
        if re.search(p, lowered):
            # Check if there is an explicit specialty mentioned (e.g. "how much does it cost to see a skin doctor?")
            explicit_spec = fallback_specialization_matcher(lowered)
            if explicit_spec:
                return {"specialization": explicit_spec, "is_emergency": False}
            return {"specialization": None, "category": "non_medical"}

    # Attempt Groq classification
    classified = call_groq_intent_classifier(raw_text)
    if classified and classified.specialization:
        return {"specialization": classified.specialization, "is_emergency": classified.is_emergency}

    # Fallback keyword matching
    fallback_spec = fallback_specialization_matcher(lowered)
    if fallback_spec:
        return {"specialization": fallback_spec, "is_emergency": False}

    # If medical terms or symptoms are present, default to General Physician
    return {"specialization": "General Physician"}

@router.post("/classify")
async def classify_intent(req: NlpRequest):
    """
    Comprehensive clinical and conversational intent classifier.
    Understands greetings, timings, fees, doctors, symptoms, appointments, emergencies, and FAQs.
    """
    raw_text = req.get_raw_text()
    if not raw_text:
        return IntentResponse(intent="clarification_required", confidence=1.0)

    # 1. Emergency safety check takes immediate priority
    if check_emergency(raw_text):
        spec = fallback_specialization_matcher(raw_text) or "Cardiologist"
        return IntentResponse(
            intent="emergency",
            confidence=0.99,
            specialization=spec,
            is_emergency=True,
            entities={"urgency": "critical"}
        )

    # 2. Query Groq LLM Classifier
    groq_result = call_groq_intent_classifier(raw_text)
    if groq_result:
        # Cross-verify specialization if symptom or fee mentioned a specialty
        if not groq_result.specialization:
            groq_result.specialization = fallback_specialization_matcher(raw_text)
        return groq_result

    # 3. Deterministic Local Pattern Classifier Fallback
    return fallback_intent_classifier(raw_text)
