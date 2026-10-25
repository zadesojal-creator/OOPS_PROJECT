import unittest
import os
import sys
from pathlib import Path

# Add ai-service to sys.path so app can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
from app.main import app
from app.api.nlp import (
    VALID_SPECIALIZATIONS,
    check_emergency,
    fallback_specialization_matcher,
    fallback_intent_classifier
)

class NlpModernizationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_specialization_preserves_contract(self):
        """Ensure /nlp/specialization continues returning {'specialization': ...}"""
        response = self.client.post("/nlp/specialization", json={"text": "I have chest pain"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("specialization", data)
        self.assertEqual(data["specialization"], "Cardiologist")

    def test_specialization_accepts_query_field(self):
        """Ensure /nlp/specialization supports query field for backward compatibility with callers"""
        response = self.client.post("/nlp/specialization", json={"query": "my skin has red spots"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("specialization", data)
        self.assertEqual(data["specialization"], "Dermatologist")

    def test_specialization_does_not_falsely_return_general_physician_for_greeting(self):
        """'hi' should NOT return General Physician as a medical match"""
        response = self.client.post("/nlp/specialization", json={"text": "hi"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertNotEqual(data.get("specialization"), "General Physician")
        self.assertEqual(data.get("category"), "non_medical")

    def test_emergency_detection(self):
        """Emergency symptoms trigger is_emergency flag"""
        self.assertTrue(check_emergency("severe chest pain and shortness of breath"))
        self.assertTrue(check_emergency("patient had a stroke and slurred speech"))
        self.assertTrue(check_emergency("unconscious and heavy bleeding"))
        self.assertFalse(check_emergency("I need a general checkup"))

        response = self.client.post("/nlp/classify", json={"text": "severe chest pain and cannot breathe"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["intent"], "emergency")
        self.assertTrue(data["is_emergency"])

    def test_greetings_classification(self):
        """Greetings route to greeting intent"""
        for msg in ["hi", "hello, can you help me?", "good morning", "hey there"]:
            response = self.client.post("/nlp/classify", json={"text": msg})
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["intent"], "greeting", f"Failed for '{msg}'")

    def test_hospital_timings_classification(self):
        """Timing questions route to hospital_timings"""
        for msg in [
            "what time do you open?",
            "is the hospital open on sunday?",
            "when can I consult the doctor?",
            "what are your opening hours?"
        ]:
            response = self.client.post("/nlp/classify", json={"text": msg})
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["intent"], "hospital_timings", f"Failed for '{msg}'")

    def test_consultation_fees_classification(self):
        """Fee questions route to consultation_fees with specialization if specified"""
        response = self.client.post("/nlp/classify", json={"text": "how much does it cost to see a skin doctor?"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["intent"], "consultation_fees")
        self.assertEqual(data["specialization"], "Dermatologist")

        response2 = self.client.post("/nlp/classify", json={"text": "what are your consultation charges?"})
        self.assertEqual(response2.status_code, 200)
        data2 = response2.json()
        self.assertEqual(data2["intent"], "consultation_fees")

    def test_doctor_and_specialties_classification(self):
        """Doctor questions route to doctor_info"""
        response = self.client.post("/nlp/classify", json={"text": "do you have a heart specialist?"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn(data["intent"], ["doctor_info", "symptom_description"])
        self.assertEqual(data["specialization"], "Cardiologist")

    def test_symptom_classification(self):
        """Symptom descriptions match appropriate specialties"""
        test_cases = [
            ("I have a red skin rash on my face", "Dermatologist"),
            ("My knee has severe joint pain when walking", "Orthopedic"),
            ("My child has a high fever and cold", "Pediatrician"),
            ("I have a severe toothache and cavity", "Dentist"),
            ("Ear pain and sore throat", "ENT"),
            ("Chronic migraine and dizziness", "Neurologist"),
        ]
        for query, expected_spec in test_cases:
            response = self.client.post("/nlp/classify", json={"text": query})
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["specialization"], expected_spec, f"Failed for '{query}'")

    def test_appointment_request_classification(self):
        """Appointment requests route to appointment_request with specialization entity"""
        response = self.client.post("/nlp/classify", json={"text": "hi, I want to book an appointment with a dentist"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["intent"], "appointment_request")
        self.assertEqual(data["specialization"], "Dentist")

        response2 = self.client.post("/nlp/classify", json={"text": "I need to book an appointment"})
        self.assertEqual(response2.status_code, 200)
        data2 = response2.json()
        self.assertEqual(data2["intent"], "appointment_request")

    def test_thanks_and_goodbye(self):
        """Thanks and goodbyes route to appropriate polite closures"""
        res_thanks = self.client.post("/nlp/classify", json={"text": "thank you for helping me"})
        self.assertEqual(res_thanks.status_code, 200)
        self.assertEqual(res_thanks.json()["intent"], "thanks")

        res_bye = self.client.post("/nlp/classify", json={"text": "bye, take care"})
        self.assertEqual(res_bye.status_code, 200)
        self.assertEqual(res_bye.json()["intent"], "goodbye")

    def test_local_fallback_engine_works_deterministically(self):
        """Fallback rule engine handles requests even without external LLM"""
        intent = fallback_intent_classifier("what time is the clinic open on sunday?")
        self.assertEqual(intent.intent, "hospital_timings")

        fee_intent = fallback_intent_classifier("how much is dermatologist fee?")
        self.assertEqual(fee_intent.intent, "consultation_fees")
        self.assertEqual(fee_intent.specialization, "Dermatologist")

        emer_intent = fallback_intent_classifier("difficulty breathing and heart attack")
        self.assertEqual(emer_intent.intent, "emergency")
        self.assertTrue(emer_intent.is_emergency)

if __name__ == "__main__":
    unittest.main()
