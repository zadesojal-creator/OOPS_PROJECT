import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { SessionService, TelegramSession } from './SessionService';
import { FamilyService } from './FamilyService';
import { db } from '../../firebase/admin';
import { getMainMenu, getCancelMenu, getFaqTopicsMenu } from '../ui';
import { handleBook } from '../workflows/BookingWorkflow';
import { handleRegister } from '../workflows/RegistrationWorkflow';
import { handleQueue } from '../workflows/QueueWorkflow';
import { handleFaq } from '../commands/faq';

export interface ClassifiedIntent {
    intent: string;
    confidence: number;
    specialization?: string | null;
    is_emergency?: boolean;
    entities?: Record<string, any>;
    polite_response?: string | null;
}

const VALID_SPECIALIZATIONS = [
    "Cardiologist",
    "Dermatologist",
    "Neurologist",
    "Orthopedic",
    "Pediatrician",
    "General Physician",
    "ENT",
    "Dentist"
];

const EMERGENCY_PATTERNS = [
    /\b(chest\s+pain|heart\s+attack|angina)\b/i,
    /\b(shortness\s+of\s+breath|can['’]?t\s+breathe|cannot\s+breathe|difficulty\s+breathing|breathless)\b/i,
    /\b(unconscious|passed\s+out|fainted|loss\s+of\s+consciousness)\b/i,
    /\b(stroke|paralysis|facial\s+droop|slurred\s+speech)\b/i,
    /\b(severe\s+bleeding|coughing\s+blood|vomiting\s+blood)\b/i,
    /\b(choking|seizure|convulsion|head\s+trauma)\b/i,
    /\b(emergency|urgent\s+care|call\s+ambulance)\b/i
];

const GREETING_PATTERNS = [
    /^(hi|hello|hey|good\s+morning|good\s+afternoon|good\s+evening|greetings|howdy|namaste)\b/i,
    /\b(can\s+you\s+help\s+me|help\s+me\s+please)\b/i
];

const THANKS_PATTERNS = [
    /\b(thank\s+you|thanks|thx|thankyou|appreciate\s+it|grateful)\b/i
];

const GOODBYE_PATTERNS = [
    /\b(bye|goodbye|see\s+you|take\s+care|cya|farewell)\b/i
];

const TIMING_PATTERNS = [
    /\b(timing|timings|opening\s+hours|open\s+hours|closing\s+time|when\s+do\s+you\s+open|what\s+time\s+do\s+you\s+open|is\s+the\s+clinic\s+open|is\s+the\s+hospital\s+open|open\s+on\s+sunday|sunday\s+opd|opd\s+hours)\b/i
];

const FEE_PATTERNS = [
    /\b(fee|fees|cost|costs|charge|charges|price|pricing|tariff|rate|how\s+much\s+does\s+it\s+cost|consultation\s+charge|payment\s+modes|insurance)\b/i
];

const LOCATION_PATTERNS = [
    /\b(where\s+are\s+you|where\s+is\s+the\s+clinic|hospital\s+location|address|landmark|parking|directions|how\s+to\s+reach)\b/i
];

const DOCTOR_INFO_PATTERNS = [
    /\b(available\s+doctors|list\s+of\s+doctors|doctors?\s+list|show\s+doctors?|our\s+doctors|who\s+are\s+(the|your)\s+doctors|doctors?\s+available|doctor\s+details|physicians|specialists(\s+available)?|do\s+you\s+have\s+a\s+(cardiologist|dermatologist|neurologist|orthopedic|pediatrician|dentist|ent|general\s+physician))\b/i,
    /\b(who\s+is\s+the|which)\s+(doctor|specialist|physician)\b/i,
    /\b(what\s+doctors|tell\s+me\s+about\s+(your\s+)?doctors)\b/i
];

const APPOINTMENT_REQUEST_PATTERNS = [
    /\b(book\s+an?\s+appointment|need\s+an?\s+appointment|schedule\s+an?\s+appointment|want\s+to\s+see\s+a?\s+doctor|meet\s+the\s+doctor|consult\s+a?\s+doctor|take\s+an?\s+appointment|make\s+an?\s+appointment|book\s+doctor)\b/i
];

const STATUS_PATTERNS = [
    /\b(check\s+status|token\s+status|appointment\s+status|my\s+token|queue\s+status|my\s+position|line\s+position)\b/i
];

const CANCEL_PATTERNS = [
    /\b(cancel\s+token|cancel\s+my\s+token|cancel\s+appointment|cancel\s+my\s+appointment|delete\s+appointment)\b/i
];

const REGISTRATION_PATTERNS = [
    /\b(register\s+patient|register\s+a\s+new\s+patient|new\s+registration|add\s+family\s+member|register\s+my\s+(mother|father|child|son|daughter|wife|husband))\b/i
];

function matchSpecializationFallback(text: string): string | null {
    const lowered = text.toLowerCase();
    if (/\b(heart|cardio|chest\s+tightness|palpitation|hypertension|blood\s+pressure|bp|ecg|angio)\b/i.test(lowered)) {
        return "Cardiologist";
    }
    if (/\b(skin|derma|rash|acne|eczema|psoriasis|allergy|hair\s+loss|dandruff|mole|cosmetology|pigmentation)\b/i.test(lowered)) {
        return "Dermatologist";
    }
    if (/\b(child|pediatric|baby|newborn|infant|toddler|vaccination|immunization|kid)\b/i.test(lowered)) {
        return "Pediatrician";
    }
    if (/\b(brain|neuro|migraine|headache|seizure|epilepsy|paralysis|nerve|neuropathy|tremor|dizziness|vertigo)\b/i.test(lowered)) {
        return "Neurologist";
    }
    if (/\b(bone|ortho|joint|knee|fracture|back\s+pain|spine|arthritis|ligament|sprain|sciatica|neck\s+pain)\b/i.test(lowered)) {
        return "Orthopedic";
    }
    if (/\b(ear|nose|throat|ent|hearing|sinus|tonsil|voice|earache|snoring)\b/i.test(lowered)) {
        return "ENT";
    }
    if (/\b(tooth|teeth|dent|dentist|dental|cavity|gum|root\s+canal|braces|jaw\s+pain)\b/i.test(lowered)) {
        return "Dentist";
    }
    if (/\b(fever|flu|cough|cold|infection|weakness|fatigue|nausea|vomiting|stomach|diabetes|checkup|general\s+doctor|physician)\b/i.test(lowered)) {
        return "General Physician";
    }
    return null;
}

function localFallbackClassifier(text: string): ClassifiedIntent {
    const lowered = text.toLowerCase();

    for (const p of EMERGENCY_PATTERNS) {
        if (p.test(lowered)) {
            const spec = matchSpecializationFallback(lowered) || "Cardiologist";
            return { intent: "emergency", confidence: 0.99, specialization: spec, is_emergency: true };
        }
    }

    for (const p of CANCEL_PATTERNS) {
        if (p.test(lowered)) return { intent: "appointment_cancellation", confidence: 0.95 };
    }

    for (const p of STATUS_PATTERNS) {
        if (p.test(lowered)) return { intent: "appointment_status", confidence: 0.95 };
    }

    for (const p of REGISTRATION_PATTERNS) {
        if (p.test(lowered)) return { intent: "patient_registration", confidence: 0.95 };
    }

    for (const p of APPOINTMENT_REQUEST_PATTERNS) {
        if (p.test(lowered)) {
            const spec = matchSpecializationFallback(lowered);
            return { intent: "appointment_request", confidence: 0.95, specialization: spec };
        }
    }

    for (const p of GREETING_PATTERNS) {
        if (p.test(lowered)) return { intent: "greeting", confidence: 0.95 };
    }

    for (const p of THANKS_PATTERNS) {
        if (p.test(lowered)) return { intent: "thanks", confidence: 0.95 };
    }

    for (const p of GOODBYE_PATTERNS) {
        if (p.test(lowered)) return { intent: "goodbye", confidence: 0.95 };
    }

    for (const p of TIMING_PATTERNS) {
        if (p.test(lowered)) return { intent: "hospital_timings", confidence: 0.92 };
    }

    for (const p of FEE_PATTERNS) {
        if (p.test(lowered)) {
            const spec = matchSpecializationFallback(lowered);
            return { intent: "consultation_fees", confidence: 0.92, specialization: spec };
        }
    }

    for (const p of LOCATION_PATTERNS) {
        if (p.test(lowered)) return { intent: "hospital_info", confidence: 0.92 };
    }

    for (const p of DOCTOR_INFO_PATTERNS) {
        if (p.test(lowered)) {
            const spec = matchSpecializationFallback(lowered);
            return { intent: "doctor_info", confidence: 0.90, specialization: spec };
        }
    }

    const spec = matchSpecializationFallback(lowered);
    if (spec) {
        return { intent: "symptom_description", confidence: 0.88, specialization: spec };
    }

    if (/\b(clinic|hospital|facility|department|services)\b/i.test(lowered)) {
        return { intent: "hospital_info", confidence: 0.80 };
    }

    return { intent: "clarification_required", confidence: 0.50 };
}

export class IntentRouter {
    /**
     * Classifies a message using Python AI FastAPI service with automatic fallback to local rule engine.
     */
    static async classifyMessage(text: string): Promise<ClassifiedIntent> {
        const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
        try {
            const response = await axios.post<ClassifiedIntent>(
                `${aiUrl}/nlp/classify`,
                { text },
                { timeout: 4500 }
            );
            if (response.data && response.data.intent) {
                // Ensure local symptom cross-validation if specialization missing
                if (!response.data.specialization) {
                    response.data.specialization = matchSpecializationFallback(text);
                }
                return response.data;
            }
        } catch (err: any) {
            console.log(`[IntentRouter] Remote AI classification fallback to local engine (${err.message})`);
        }

        return localFallbackClassifier(text);
    }

    /**
     * Primary entry point for routing unhandled or conversational text messages.
     */
    static async routeMessage(
        bot: TelegramBot,
        msg: TelegramBot.Message,
        session: TelegramSession
    ): Promise<void> {
        const chatId = msg.chat.id;
        const text = (msg.text || '').trim();
        const lowered = text.toLowerCase();

        // 1. Classify Intent
        const classified = await this.classifyMessage(text);
        const { intent, specialization, is_emergency } = classified;

        console.log(`[IntentRouter] Chat ${chatId} intent="${intent}" spec="${specialization || 'none'}" emer=${is_emergency}`);

        // 2. EMERGENCY ROUTING (Absolute Priority)
        if (intent === 'emergency' || is_emergency) {
            const emergencyText =
                `🚨 **EMERGENCY MEDICAL ADVISORY** 🚨\n\n` +
                `If you or someone nearby is experiencing acute symptoms such as severe chest pain, shortness of breath, loss of consciousness, stroke symptoms, or heavy bleeding, **please seek immediate emergency medical care**.\n\n` +
                `📞 **Clinic Emergency Line:** +1 (555) 019-EMERGENCY (+1 555-019-3637)\n` +
                `🚑 **Ambulance Dispatch:** +1 (555) 019-AMBU (+1 555-019-2628)\n` +
                `🏥 **Hospital Address:** 42 Metro Wellness Blvd, Health City, Sector 5 (Opp. Central Metro Gate 2)\n\n` +
                `Our Emergency & Triage department is open **24 Hours / 7 Days a week** with immediate walk-in priority.`;

            await bot.sendMessage(chatId, emergencyText, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
            return;
        }

        // 3. CONVERSATIONAL GREETINGS
        if (intent === 'greeting') {
            const active = await FamilyService.getActivePatient(chatId);
            const firstName = msg.from?.first_name || '';
            const greetingName = active?.name ? `**${active.name}**` : firstName ? `**${firstName}**` : 'there';

            const politeGreeting =
                `Hello ${greetingName}! Welcome to **ClinicQueue**. 😊\n\n` +
                `I can assist you with hospital information, doctor timings, consultation fees, live queue tokens, and booking appointments.\n\n` +
                `How can I help you today? You can choose an option below or simply ask me any question:`;

            await bot.sendMessage(chatId, politeGreeting, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
            return;
        }

        // 4. GRATITUDE & THANKS
        if (intent === 'thanks') {
            const thanksReply =
                `You are most welcome! 😊\n\n` +
                `Wishing you and your family good health. Let me know if you need anything else!`;

            await bot.sendMessage(chatId, thanksReply, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
            return;
        }

        // 5. GOODBYE & CLOSURE
        if (intent === 'goodbye') {
            const goodbyeReply =
                `Goodbye! Take care and stay healthy. 🌟\n\n` +
                `ClinicQueue is available 24/7 whenever you or your family need medical care.`;

            await bot.sendMessage(chatId, goodbyeReply, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
            return;
        }

        // 6. APPOINTMENT CANCELLATION
        if (intent === 'appointment_cancellation') {
            await handleQueue(bot, msg, session, 'CANCEL');
            return;
        }

        // 7. APPOINTMENT / TOKEN STATUS
        if (intent === 'appointment_status') {
            await handleQueue(bot, msg, session, 'STATUS');
            return;
        }

        // 8. PATIENT REGISTRATION
        if (intent === 'patient_registration') {
            await handleRegister(bot, msg, session);
            return;
        }

        // 9. APPOINTMENT BOOKING REQUEST
        if (intent === 'appointment_request') {
            const members = await FamilyService.getFamilyMembers(chatId);
            if (members.length === 0) {
                const regMsg =
                    `📅 **Appointment Booking**\n\n` +
                    `To schedule an appointment, we need to register a patient profile for you or your family member first.\n\n` +
                    `Tap **📝 Register a New Patient** below to get started in just a minute:`;

                await bot.sendMessage(chatId, regMsg, {
                    parse_mode: 'Markdown',
                    ...getMainMenu()
                });
                return;
            }

            // If a specific specialization was mentioned (e.g., "book appointment with a dentist")
            if (specialization && VALID_SPECIALIZATIONS.includes(specialization)) {
                const targetPatient = session.patientId ? members.find(m => m.patientId === session.patientId) || members[0] : members[0];
                
                await SessionService.updateSession(chatId, {
                    patientId: targetPatient.patientId,
                    patientName: targetPatient.name,
                    state: 'BOOKING_DOCTOR',
                    booking_spec: specialization
                });

                // Fetch active doctors for this specialization
                const usersSnap = await db.collection('users')
                    .where('role', '==', 'DOCTOR')
                    .where('active', '==', true)
                    .get();

                const doctors = usersSnap.docs
                    .map(d => ({ id: d.id, ...d.data() } as any))
                    .filter(d => (d.specialization || '').toLowerCase() === specialization.toLowerCase());

                if (doctors.length > 0) {
                    const docKeyboard = doctors.map(d => [{ text: `Dr. ${d.name}` }]);
                    docKeyboard.push([{ text: "🔙 Cancel" }]);

                    await bot.sendMessage(chatId, `📅 Booking **${specialization}** consultation for **${targetPatient.name}** (${targetPatient.relationship}):\n\nPlease select a physician:`, {
                        parse_mode: 'Markdown',
                        reply_markup: { keyboard: docKeyboard, resize_keyboard: true }
                    });
                    return;
                }
            }

            // General booking router
            await handleBook(bot, msg, session);
            return;
        }

        // 10. SYMPTOM DESCRIPTION / SPECIALIZATION ADVISORY
        if (intent === 'symptom_description') {
            const matchedSpec = specialization || matchSpecializationFallback(text) || "General Physician";
            
            // Look up matching doctors in clinic records
            const usersSnap = await db.collection('users')
                .where('role', '==', 'DOCTOR')
                .where('active', '==', true)
                .get();

            const doctors = usersSnap.docs
                .map(d => ({ id: d.id, ...d.data() } as any))
                .filter(d => (d.specialization || '').toLowerCase() === matchedSpec.toLowerCase());

            let doctorLine = '';
            if (doctors.length > 0) {
                doctorLine = `👨‍⚕️ **Available Specialists:** ` + doctors.map(d => `Dr. ${d.name} (${d.room || 'Clinic Consultation'})`).join(', ') + `\n\n`;
            }

            const advisoryText =
                `🩺 **Clinical Guidance & Specialty Recommendation**\n\n` +
                `Based on your described symptoms, we recommend consulting our **${matchedSpec}** department.\n\n` +
                doctorLine +
                `Would you like to schedule an appointment with a ${matchedSpec}, or request a walk-in token?\n\n` +
                `You can tap **📅 Book an Appointment** or **🎫 Request Token** below:`;

            await bot.sendMessage(chatId, advisoryText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        [{ text: "📅 Book an Appointment" }, { text: "🎫 Request Token" }],
                        [{ text: "❓ Help / Clinic FAQs" }, { text: "🔙 Main Menu" }]
                    ],
                    resize_keyboard: true
                }
            });
            return;
        }

        // 11. HOSPITAL TIMINGS
        if (intent === 'hospital_timings') {
            const timingsAnswer =
                `⏰ **Clinic Operating Hours & Schedule**\n\n` +
                `• **Outpatient Clinics (OPD):** Monday to Saturday, 08:30 AM to 08:30 PM\n` +
                `• **Sunday Special OPD:** 09:00 AM to 01:00 PM (General Medicine & Pediatrics)\n` +
                `• **Emergency & Urgent Care:** 24 Hours / 7 Days a week (Always Open)\n` +
                `• **Pathology & Diagnostic Laboratory:** 07:00 AM to 09:00 PM (Home blood collection from 06:30 AM)\n` +
                `• **In-House Pharmacy:** 24/7 continuous operation\n\n` +
                `Appointments can be booked in advance, and walk-in patients are accepted throughout OPD hours.`;

            await bot.sendMessage(chatId, timingsAnswer, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
            return;
        }

        // 12. CONSULTATION FEES & CHARGES
        if (intent === 'consultation_fees') {
            let feeDetail = '';
            if (specialization === 'Dermatologist') {
                feeDetail = `• **Dermatologist Consultation:** $50 (First Visit) | $30 (Follow-up within 7 days)\n`;
            } else if (specialization === 'Cardiologist') {
                feeDetail = `• **Cardiologist Consultation:** $60 (First Visit) | $40 (Follow-up within 7 days)\n`;
            } else if (specialization === 'Dentist') {
                feeDetail = `• **Dental Consultation & Examination:** $35\n`;
            } else if (specialization === 'Neurologist') {
                feeDetail = `• **Neurologist Consultation:** $75 (First Visit) | $50 (Follow-up within 7 days)\n`;
            } else if (specialization === 'Orthopedic') {
                feeDetail = `• **Orthopedic Specialist:** $55 (First Visit) | $35 (Follow-up within 7 days)\n`;
            } else if (specialization === 'Pediatrician') {
                feeDetail = `• **Pediatrician Consultation:** $40 (First Visit) | $25 (Follow-up within 7 days)\n`;
            } else if (specialization === 'ENT') {
                feeDetail = `• **ENT Specialist:** $45 (First Visit) | $30 (Follow-up within 7 days)\n`;
            }

            const feeAnswer =
                `💳 **ClinicQueue Consultation Fees & Tariff Structure**\n\n` +
                (feeDetail ? `${feeDetail}\n` : '') +
                `• **General Physician:** $35 (Initial visit) | $20 (Follow-up within 7 days)\n` +
                `• **Medical Specialists:** $45 to $75 depending on department\n` +
                `• **Dental Consultation:** $35\n` +
                `• **Emergency Room Triage:** $50 baseline assessment\n` +
                `• **Follow-up Policy:** Any follow-up consultation within 7 days receives a discounted rate\n` +
                `• **Payment Modes:** Cash, Visa, MasterCard, Apple Pay, Google Pay, UPI\n` +
                `• **Health Insurance:** Empanelled with major TPAs for cashless outpatient claims.`;

            await bot.sendMessage(chatId, feeAnswer, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
            return;
        }

        // 13. HOSPITAL INFORMATION & LOCATION
        if (intent === 'hospital_info') {
            const infoAnswer =
                `🏥 **ClinicQueue Multispecialty Clinic & Healthcare Center**\n\n` +
                `📍 **Address:** 42 Metro Wellness Boulevard, Health City, Sector 5\n` +
                `🚇 **Landmark:** Opposite Central Metro Station, Gate No. 2\n` +
                `♿ **Accessibility:** 100% wheelchair accessible with ramp & elevator\n` +
                `🚗 **Parking:** Complimentary basement valet parking for patients\n` +
                `📞 **Reception Desk:** +1 (555) 019-2834 / +1 (555) 019-2835\n` +
                `🚨 **24/7 Emergency Line:** +1 (555) 019-EMERGENCY (+1 555-019-3637)\n\n` +
                `We offer smart walk-in digital queues, pre-scheduled specialist appointments, an in-house 24/7 digital pharmacy, and diagnostic pathology under one roof.`;

            await bot.sendMessage(chatId, infoAnswer, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
            return;
        }

        // 14. DOCTOR INFORMATION
        if (intent === 'doctor_info') {
            const usersSnap = await db.collection('users')
                .where('role', '==', 'DOCTOR')
                .where('active', '==', true)
                .get();

            let docList = '';
            const allDoctors = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

            // If a specific specialization was mentioned or inferred (e.g. "who is your cardiologist?")
            const targetSpec = specialization || matchSpecializationFallback(text);
            const filteredDocs = targetSpec 
                ? allDoctors.filter(d => (d.specialization || '').toLowerCase() === targetSpec.toLowerCase())
                : allDoctors;

            const docsToShow = filteredDocs.length > 0 ? filteredDocs : allDoctors;

            if (docsToShow.length > 0) {
                docList = docsToShow.map(data => {
                    const cleanName = (data.name || '').replace(/^Dr\.\s*/i, '');
                    const feeStr = data.fee ? ` | Fee: ${data.fee}` : '';
                    const dutyStr = data.onDuty !== false ? ' (On Duty)' : '';
                    return `• **Dr. ${cleanName}** — ${data.specialization || 'Physician'} (${data.room || 'Cabin 101'})${dutyStr}${feeStr}`;
                }).join('\n');
            } else {
                docList =
                    `• **Dr. Rajesh Sharma** — General Physician (Cabin 101) | Fee: $35\n` +
                    `• **Dr. Priya Patel** — Cardiologist (Cabin 204) | Fee: $60\n` +
                    `• **Dr. Ananya Sen** — Dermatologist (Cabin 105) | Fee: $50\n` +
                    `• **Dr. Vikram Verma** — Neurologist (Cabin 208) | Fee: $75\n` +
                    `• **Dr. Rohan Mehta** — Orthopedic Surgeon (Cabin 103) | Fee: $55\n` +
                    `• **Dr. Sunita Rao** — Pediatrician (Cabin 102) | Fee: $40\n` +
                    `• **Dr. Amit Deshmukh** — ENT Specialist (Cabin 107) | Fee: $45\n` +
                    `• **Dr. Neha Kapoor** — Dental Surgeon (Cabin 108) | Fee: $35`;
            }

            const headerTitle = targetSpec && filteredDocs.length > 0 
                ? `👨‍⚕️ **ClinicQueue ${targetSpec} Specialists**` 
                : `👨‍⚕️ **ClinicQueue Clinical Team & Specialists**`;

            const docAnswer =
                `${headerTitle}\n\n` +
                docList + `\n\n` +
                `You can tap **📅 Book an Appointment** below to schedule a visit with any of our physicians.`;

            await bot.sendMessage(chatId, docAnswer, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
            return;
        }

        // 15. CLARIFICATION OR UNKNOWN INQUIRY -> Query RAG knowledge base
        try {
            const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
            const ragRes = await axios.post(`${aiUrl}/rag/query`, { question: text }, { timeout: 8000 });
            if (ragRes.data?.answer && !ragRes.data?.insufficient_context) {
                const answer = ragRes.data.answer;
                await bot.sendMessage(chatId, answer, {
                    parse_mode: 'Markdown',
                    ...getMainMenu()
                });
                return;
            }
        } catch (e: any) {
            // RAG unavailable, proceed to polite clarification
        }

        // Polite Clarification fallback
        const clarificationText =
            `I want to make sure I assist you correctly! 😊\n\n` +
            `I can help you with:\n` +
            `• **📅 Book an Appointment** with any specialist\n` +
            `• **🎫 Live Queue Token** for walk-in visits\n` +
            `• **⏰ Operating Hours** & doctor consultation timings\n` +
            `• **💳 Consultation Fees** and accepted insurances\n` +
            `• **📍 Hospital Location**, address, and emergency contact\n\n` +
            `Please choose an option from the menu below or describe what you need:`;

        await bot.sendMessage(chatId, clarificationText, {
            parse_mode: 'Markdown',
            ...getMainMenu()
        });
    }
}
