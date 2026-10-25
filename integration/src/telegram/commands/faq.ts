import TelegramBot from 'node-telegram-bot-api';
import { TelegramSession, SessionService } from '../services/SessionService';
import { getMainMenu, getFaqTopicsMenu } from '../ui';
import axios from 'axios';

const TOPIC_QUESTIONS: Record<string, string> = {
    'Hospital Info': 'What is ClinicQueue hospital information and overview?',
    'Doctors': 'Who are the doctors available at ClinicQueue and what are their specializations?',
    'Departments': 'What medical departments and specialties are available at ClinicQueue?',
    'Timings': 'What are the clinic visiting, outpatient OPD, emergency, and pharmacy operating hours?',
    'Services': 'What medical services, diagnostic lab, and treatments are provided?',
    'Fees': 'What are the consultation fees, specialist charges, and payment options?',
    'Location': 'Where is ClinicQueue located, address, landmark, and parking?',
    'Emergency Info': 'What is the emergency contact number, triage procedure, and ambulance line?'
};

const TOPIC_FALLBACKS: Record<string, string> = {
    'Hospital Info': `🏥 *ClinicQueue Multispecialty Clinic & Healthcare Center*\n\nClinicQueue is a modern, state-of-the-art outpatient healthcare facility dedicated to providing compassionate, efficient, and affordable medical care. Our facility integrates smart walk-in digital queues, pre-scheduled specialist appointments, an in-house digital pharmacy, and advanced pathology diagnostics under one roof.`,
    'Doctors': `👨‍⚕️ *Available Physicians & Care Team*\n\n• *Dr. Smith* — General Physician (Room 101, Fee: $35)\n• *Dr. Sarah Jenkins* — Cardiologist (Heart Health & ECG)\n• *Dr. Michael Chang* — Neurologist (Nerve & Brain Care)\n• *Dr. Lisa Ray* — Pediatrician (Child Health)\n• *Dr. David Miller* — Orthopedics & Joint Care\n• *Dr. Emily Watson* — Dermatologist\n• *Dr. Robert Taylor* — ENT Specialist\n• *Dr. Anna Davis* — Dental & Oral Health`,
    'Departments': `🏥 *Medical Departments & Specialties*\n\n1. *General Medicine & Family Practice*: Comprehensive diagnosis, diabetes, hypertension, routine checkups\n2. *Cardiology*: Heart health, ECG, 2D-Echocardiogram\n3. *Dermatology & Cosmetology*: Skin, hair, allergies, laser care\n4. *Neurology*: Headaches, migraines, epilepsy, nerve disorders\n5. *Orthopedics & Joint Care*: Bone fractures, joint pain, arthritis\n6. *Pediatrics & Child Health*: Newborn care, immunizations, growth assessment\n7. *ENT*: Hearing assessments, sinus treatment, throat care\n8. *Dental & Oral Health*: Teeth cleaning, digital X-rays, root canals`,
    'Timings': `⏰ *Clinic Operating Hours & Schedule*\n\n• *Outpatient Clinics (OPD)*: Monday to Saturday, 08:30 AM to 08:30 PM\n• *Sunday Special OPD*: 09:00 AM to 01:00 PM (General Med & Pediatrics only)\n• *Emergency & Urgent Care*: 24 Hours / 7 Days a week (Always Open)\n• *Pathology Laboratory*: 07:00 AM to 09:00 PM (Home blood collection from 06:30 AM)\n• *Pharmacy*: 24/7 continuous operation`,
    'Services': `🩺 *Medical Services & Diagnostic Facilities*\n\n• Smart walk-in digital queue & scheduled appointments\n• In-house 24/7 digital pharmacy\n• Pathology Lab (CBC, Lipid, LFT/KFT, HbA1c, Thyroid) with <2 hr turnaround\n• 12-lead Digital ECG, Holter monitoring, 2D Echocardiography\n• Low-radiation Digital X-Ray & High-Resolution Ultrasound / Sonography`,
    'Fees': `💳 *Consultation Fees & Tariff Structure*\n\n• *General Physician*: $35 (Initial visit) | $20 (Follow-up within 7 days)\n• *Specialist Consultation*: $45 to $75 depending on specialty\n• *Dental Consultation*: $35\n• *Emergency Room Triage*: $50 baseline assessment fee\n• *Payment Modes*: Cash, Visa, MasterCard, Apple Pay, Google Pay, UPI\n• *Health Insurance*: Cashless outpatient coverage with major TPAs`,
    'Location': `📍 *Location & Address*\n\n• *Address*: ClinicQueue Healthcare Center, 42 Metro Wellness Boulevard, Health City, Sector 5\n• *Landmark*: Opposite Central Metro Station, Gate No. 2\n• *Accessibility*: 100% wheelchair accessible with ramp & elevator\n• *Parking*: Complimentary basement valet parking for patients`,
    'Emergency Info': `🚨 *24/7 Emergency & Urgent Care*\n\n• *Emergency Line*: +1 (555) 019-EMERGENCY (+1 555-019-3637)\n• *Ambulance Dispatch*: +1 (555) 019-AMBU (+1 555-019-2628)\n• *General Reception*: +1 (555) 019-2834 / +1 (555) 019-2835\n• *Triage Priority*: Immediate priority consultation without waiting for acute trauma, severe chest pain, or critical symptoms.`
};

export async function handleFaq(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const lowered = text.toLowerCase();

    // Handle return to main menu or cancel
    if (text === '🔙 Main Menu' || text === '🔙 Cancel' || text === '❌ Cancel' || lowered === 'cancel' || lowered === 'menu') {
        await SessionService.clearSession(chatId);
        await bot.sendMessage(chatId, 'Returned to main menu.', getMainMenu(!!session.patientId));
        return;
    }

    // Check if triggering initial FAQ mode
    const isEnterFaq =
        text === '❓ Help / Clinic FAQs' ||
        text === 'Help / Clinic FAQs' ||
        text === '❓ Clinic FAQ' ||
        text === 'Clinic FAQ' ||
        lowered === '/faq' ||
        lowered === 'faq' ||
        lowered === '/faqs' ||
        lowered === 'faqs' ||
        lowered === '/help' ||
        lowered === 'help' ||
        session.state !== 'FAQ_QUESTION';

    if (isEnterFaq && !TOPIC_QUESTIONS[text]) {
        await SessionService.updateSession(chatId, { state: 'FAQ_QUESTION' });
        await bot.sendMessage(chatId, `💬 *Clinic Information & AI Assistant*\n\nChoose a topic below or type any question you have about our doctors, clinic hours, departments, or fees:`, {
            parse_mode: 'Markdown',
            ...getFaqTopicsMenu()
        });
        return;
    }

    // Active in FAQ_QUESTION mode OR asking a direct topic
    await SessionService.updateSession(chatId, { state: 'FAQ_QUESTION' });

    const question = TOPIC_QUESTIONS[text] || text;
    const fallbackAnswer = TOPIC_FALLBACKS[text];

    await bot.sendMessage(chatId, '🔍 Searching clinic knowledge base...');

    let answer: string | null = null;
    try {
        const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
        const response = await axios.post(`${aiUrl}/rag/query`, { question }, { timeout: 15000 });

        if (response.data?.answer && !response.data?.insufficient_context) {
            answer = response.data.answer;
        } else if (fallbackAnswer) {
            answer = fallbackAnswer;
        } else if (response.data?.answer) {
            answer = response.data.answer;
        }
    } catch (err: any) {
        console.warn(`[FAQ] AI service query failed: ${err.message}. Using fallback knowledge.`);
        if (fallbackAnswer) {
            answer = fallbackAnswer;
        }
    }

    if (!answer) {
        answer = fallbackAnswer || "I couldn't find this specific detail in the clinic records. Please contact our reception desk at +1 (555) 019-2834 for assistance.";
    }

    const replyText = `${answer}\n\n_Tap another topic below or ask another question. Tap 🔙 Main Menu to exit._`;

    try {
        await bot.sendMessage(chatId, replyText, {
            parse_mode: 'Markdown',
            ...getFaqTopicsMenu()
        });
    } catch (formatErr) {
        // Fallback to plain text if Markdown parsing fails
        await bot.sendMessage(chatId, replyText.replace(/[*_`]/g, ''), {
            ...getFaqTopicsMenu()
        });
    }
}
