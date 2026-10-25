import TelegramBot from 'node-telegram-bot-api';
import { TelegramSession, SessionService } from '../services/SessionService';
import { FamilyService, FamilyMemberRecord } from '../services/FamilyService';
import { handleRegister } from './RegistrationWorkflow';
import { db } from '../../firebase/admin';
import { CppEngine } from '../../cpp-adapter/CppEngine';
import { getMainMenu, getCancelMenu } from '../ui';
import axios from 'axios';

const SPECIALIZATIONS = [
    "General Physician",
    "Cardiologist",
    "Dermatologist",
    "Neurologist",
    "Orthopedic",
    "Pediatrician",
    "ENT",
    "Dentist"
];

export async function getAvailableSpecializations(): Promise<string[]> {
    try {
        const snap = await db.collection('users').where('role', '==', 'DOCTOR').where('active', '==', true).get();
        const activeDoctorSpecs = snap.docs.map(d => d.data().specialization).filter(Boolean);
        return Array.from(new Set([...SPECIALIZATIONS, ...activeDoctorSpecs])).sort();
    } catch {
        return SPECIALIZATIONS;
    }
}

export async function handleBook(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    const members = await FamilyService.getFamilyMembers(chatId);

    if (members.length === 0) {
        bot.sendMessage(chatId, '⚠️ You must register a patient first before booking an appointment. Please tap **📝 Register a New Patient** below:', {
            parse_mode: 'Markdown',
            ...getMainMenu()
        });
        return;
    }

    if (members.length > 1) {
        await SessionService.updateSession(chatId, { state: 'BOOKING_PATIENT_SELECT' });

        const keyboard: TelegramBot.KeyboardButton[][] = members.map(m => [
            { text: `👤 ${m.name} (${m.relationship})` }
        ]);
        keyboard.push([{ text: "➕ Register Another Patient" }]);
        keyboard.push([{ text: "🔙 Cancel" }]);

        bot.sendMessage(chatId, `📅 **Who needs an appointment?**\n\nPlease select the patient from your family:`, {
            parse_mode: 'Markdown',
            reply_markup: { keyboard, resize_keyboard: true }
        });
        return;
    }

    // Exactly 1 family member
    const single = members[0];
    await SessionService.updateSession(chatId, {
        patientId: single.patientId,
        patientName: single.name,
        state: 'BOOKING_SPECIALIZATION'
    });

    const specs = await getAvailableSpecializations();
    const keyboard: TelegramBot.KeyboardButton[][] = [];
    for (let i = 0; i < specs.length; i += 2) {
        const row = [{ text: specs[i] }];
        if (i + 1 < specs.length) row.push({ text: specs[i + 1] });
        keyboard.push(row);
    }
    keyboard.push([{ text: "🔙 Cancel" }]);

    bot.sendMessage(chatId, `📅 Booking appointment for **${single.name}** (${single.relationship})\n\n🩺 **Please select a medical specialization or type symptoms (e.g. fever, headache):**`, {
        parse_mode: 'Markdown',
        reply_markup: { keyboard, resize_keyboard: true }
    });
}

export async function processBooking(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const lowered = text.toLowerCase();

    // Check cancel
    if (lowered === 'cancel' || text === '🔙 Cancel' || text === '❌ Cancel' || text === '/cancel') {
        await SessionService.clearSession(chatId);
        bot.sendMessage(chatId, '❌ Appointment booking cancelled.', getMainMenu());
        return;
    }

    // 0. Family Member Selection Step
    if (session.state === 'BOOKING_PATIENT_SELECT') {
        if (text === '➕ Register Another Patient' || text === '📝 Register a New Patient') {
            await handleRegister(bot, msg, session);
            return;
        }

        const members = await FamilyService.getFamilyMembers(chatId);
        let chosen: FamilyMemberRecord | null = null;

        for (const m of members) {
            if (text === `👤 ${m.name} (${m.relationship})` || text.toLowerCase().includes(m.name.toLowerCase())) {
                chosen = m;
                break;
            }
        }

        const num = parseInt(text, 10);
        if (!chosen && !isNaN(num) && num >= 1 && num <= members.length) {
            chosen = members[num - 1];
        }

        if (!chosen) {
            bot.sendMessage(chatId, '⚠️ Please select a family member from the menu below or tap **🔙 Cancel**:');
            return;
        }

        await SessionService.updateSession(chatId, {
            patientId: chosen.patientId,
            patientName: chosen.name,
            state: 'BOOKING_SPECIALIZATION'
        });

        const specs = await getAvailableSpecializations();
        const keyboard: TelegramBot.KeyboardButton[][] = [];
        for (let i = 0; i < specs.length; i += 2) {
            const row = [{ text: specs[i] }];
            if (i + 1 < specs.length) row.push({ text: specs[i + 1] });
            keyboard.push(row);
        }
        keyboard.push([{ text: "🔙 Cancel" }]);

        bot.sendMessage(chatId, `👤 Selected Patient: **${chosen.name}** (${chosen.relationship})\n\n🩺 **Please select a specialization or type symptoms (e.g. fever, headache):**`, {
            parse_mode: 'Markdown',
            reply_markup: { keyboard, resize_keyboard: true }
        });
        return;
    }

    // 1. Specialization Step
    if (session.state === 'BOOKING_SPECIALIZATION') {
        const availableSpecs = await getAvailableSpecializations();
        let spec = text;
        const matched = availableSpecs.find(s => s.toLowerCase() === text.toLowerCase());

        if (matched) {
            spec = matched;
        } else {
            // Symptom NLP mapping
            bot.sendMessage(chatId, '🔍 Analyzing symptoms with clinical AI...');
            try {
                const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
                const res = await axios.post(`${aiUrl}/nlp/specialization`, { text, query: text }, { timeout: 8000 });
                if (res.data && res.data.is_emergency) {
                    bot.sendMessage(chatId, `🚨 **URGENT WARNING:** Your symptoms may require urgent medical care. If you are experiencing acute pain, breathlessness, or trauma, please call our 24/7 Emergency Line: **+1 (555) 019-3637** or visit Emergency Triage immediately.`, { parse_mode: 'Markdown' });
                }
                if (res.data && res.data.specialization) {
                    spec = res.data.specialization;
                    bot.sendMessage(chatId, `💡 Based on symptoms, we recommend: **${spec}**`, { parse_mode: 'Markdown' });
                }
            } catch (e) {
                console.log('AI symptom fallback to General Physician:', e);
                spec = "General Physician";
            }
        }

        // Query active doctors with this specialization
        const usersSnap = await db.collection('users')
            .where('role', '==', 'DOCTOR')
            .where('active', '==', true)
            .get();

        const doctors = usersSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter(d => (d.specialization || '').toLowerCase() === spec.toLowerCase());

        if (doctors.length === 0) {
            const currentSpecs = await getAvailableSpecializations();
            const keyboard = currentSpecs.map(s => [{ text: s }]);
            keyboard.push([{ text: "🔙 Cancel" }]);
            bot.sendMessage(chatId, `⚠️ No active doctors available right now for **${spec}**. Please select another specialty:`, {
                parse_mode: 'Markdown',
                reply_markup: { keyboard, resize_keyboard: true }
            });
            return;
        }

        await SessionService.updateSession(chatId, {
            state: 'BOOKING_DOCTOR',
            booking_spec: spec
        });

        const docKeyboard = doctors.map(d => [{ text: `Dr. ${d.name}` }]);
        docKeyboard.push([{ text: "🔙 Cancel" }]);

        bot.sendMessage(chatId, `👨‍⚕️ Available doctors for **${spec}**:\n\nPlease select a physician:`, {
            parse_mode: 'Markdown',
            reply_markup: { keyboard: docKeyboard, resize_keyboard: true }
        });
        return;
    }

    // 2. Doctor Step
    if (session.state === 'BOOKING_DOCTOR') {
        const cleanName = text.replace(/^Dr\.\s*/i, '').trim();

        const usersSnap = await db.collection('users')
            .where('role', '==', 'DOCTOR')
            .where('active', '==', true)
            .get();

        const matchedDoc = usersSnap.docs.find(d => {
            const data = d.data();
            return data.name.toLowerCase().includes(cleanName.toLowerCase());
        });

        if (!matchedDoc) {
            bot.sendMessage(chatId, '⚠️ Please select a doctor from the buttons below:');
            return;
        }

        const doctorId = matchedDoc.id;
        const doctorData = matchedDoc.data();

        await SessionService.updateSession(chatId, {
            state: 'BOOKING_DATE',
            booking_doc_id: doctorId,
            booking_doc_name: doctorData.name
        });

        // Generate next 5 business dates
        const dateKeyboard: TelegramBot.KeyboardButton[][] = [];
        let curr = new Date();
        for (let i = 0; i < 7 && dateKeyboard.length < 5; i++) {
            const dStr = curr.toISOString().split('T')[0];
            const dayName = curr.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            dateKeyboard.push([{ text: `${dStr} (${dayName})` }]);
            curr.setDate(curr.getDate() + 1);
        }
        dateKeyboard.push([{ text: "🔙 Cancel" }]);

        bot.sendMessage(chatId, `📅 **Select Date for Dr. ${doctorData.name}:**`, {
            parse_mode: 'Markdown',
            reply_markup: { keyboard: dateKeyboard, resize_keyboard: true }
        });
        return;
    }

    // 3. Date Step
    if (session.state === 'BOOKING_DATE') {
        const dateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) {
            bot.sendMessage(chatId, '⚠️ Please choose a date from the options provided below:');
            return;
        }

        const dateStr = dateMatch[1];
        bot.sendMessage(chatId, `⏳ Checking available time slots for **${dateStr}**...`);

        try {
            const doctorId = session.booking_doc_id!;
            const schedDoc = await db.collection('doctor_schedules').doc(doctorId).get();
            const holDocs = await db.collection('doctor_holidays').where('doctorId', '==', doctorId).where('date', '==', dateStr).get();
            const aptDocs = await db.collection('appointments').where('doctorId', '==', doctorId).where('date', '==', dateStr).get();

            // 1. Holiday check
            if (!holDocs.empty) {
                const holiday = holDocs.docs[0].data();
                bot.sendMessage(chatId, `⚠️ Dr. ${session.booking_doc_name || 'the doctor'} is on leave on ${dateStr} (${holiday.reason || 'Holiday'}). Please choose another date:`);
                return;
            }

            const schedule = schedDoc.exists ? schedDoc.data() : {
                workingDays: [1, 2, 3, 4, 5, 6],
                startTime: "09:00", endTime: "17:00",
                lunchStart: "13:00", lunchEnd: "14:00",
                slotDurationMinutes: 20, maxAppointments: 20
            };
            const bookedSlots: string[] = [];
            aptDocs.forEach(d => {
                const a = d.data();
                if (a.status !== 'CANCELLED') bookedSlots.push(a.startTime);
            });

            // 2. Max appointments check
            if (schedule?.maxAppointments && bookedSlots.length >= schedule.maxAppointments) {
                bot.sendMessage(chatId, `⚠️ Dr. ${session.booking_doc_name || 'the doctor'} has reached the maximum appointment limit (${schedule.maxAppointments}) for ${dateStr}. Please select another date:`);
                return;
            }

            // 3. Call C++ Engine using generateSlots
            const slotsResult = await CppEngine.execute('generateSlots', {
                startTime: schedule?.startTime || "09:00",
                endTime: schedule?.endTime || "17:00",
                lunchStart: schedule?.lunchStart || "13:00",
                lunchEnd: schedule?.lunchEnd || "14:00",
                slotDurationMinutes: schedule?.slotDurationMinutes || 20,
                workingDays: schedule?.workingDays || [1, 2, 3, 4, 5, 6],
                bookedSlots,
                targetDate: dateStr,
                nowUtc: new Date().toISOString()
            });

            const slots: string[] = slotsResult.slots || [];

            if (slots.length === 0) {
                bot.sendMessage(chatId, `⚠️ No available slots for Dr. ${session.booking_doc_name || 'the doctor'} on ${dateStr} (Fully Booked or Off Duty). Please select another date:`);
                return;
            }

            await SessionService.updateSession(chatId, {
                state: 'BOOKING_TIME',
                booking_date_val: dateStr
            });

            const slotKeyboard: TelegramBot.KeyboardButton[][] = [];
            for (let i = 0; i < slots.length; i += 3) {
                const row = [{ text: slots[i] }];
                if (i + 1 < slots.length) row.push({ text: slots[i + 1] });
                if (i + 2 < slots.length) row.push({ text: slots[i + 2] });
                slotKeyboard.push(row);
            }
            slotKeyboard.push([{ text: "🔙 Cancel" }]);

            bot.sendMessage(chatId, `⏰ Available consultation slots on **${dateStr}**:\n\nPlease choose a time slot:`, {
                parse_mode: 'Markdown',
                reply_markup: { keyboard: slotKeyboard, resize_keyboard: true }
            });
            return;
        } catch (e: any) {
            console.error('Error computing slots in Telegram booking:', e);
            bot.sendMessage(chatId, `⚠️ Could not retrieve available slots: ${e.message}`, getMainMenu());
            await SessionService.clearSession(chatId);
            return;
        }
    }

    // 4. Time Step
    if (session.state === 'BOOKING_TIME') {
        const timeVal = text.trim();
        if (!timeVal.match(/^\d{2}:\d{2}$/)) {
            bot.sendMessage(chatId, '⚠️ Please select a valid time slot from the buttons below:');
            return;
        }

        await SessionService.updateSession(chatId, {
            state: 'BOOKING_CONFIRM',
            booking_time_val: timeVal
        });

        const summary = `📋 **Confirm Your Appointment**\n\n` +
            `• **Patient**: **${session.patientName || 'Selected Patient'}**\n` +
            `• **Doctor**: Dr. ${session.booking_doc_name}\n` +
            `• **Specialization**: ${session.booking_spec}\n` +
            `• **Date**: ${session.booking_date_val}\n` +
            `• **Time Slot**: ${timeVal}\n\n` +
            `Would you like to confirm this booking?`;

        bot.sendMessage(chatId, summary, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    [{ text: "✅ Confirm Booking" }],
                    [{ text: "❌ Cancel" }]
                ],
                resize_keyboard: true
            }
        });
        return;
    }

    // 5. Confirm Step
    if (session.state === 'BOOKING_CONFIRM') {
        if (text === "✅ Confirm Booking" || lowered === "confirm" || lowered === "yes") {
            bot.sendMessage(chatId, '⏳ Confirming your appointment...');

            try {
                const doctorId = session.booking_doc_id!;
                const dateStr = session.booking_date_val!;
                const timeVal = session.booking_time_val!;
                const targetPatientId = session.patientId!;

                // Check conflict
                const aptDocs = await db.collection('appointments')
                    .where('doctorId', '==', doctorId)
                    .where('date', '==', dateStr)
                    .where('startTime', '==', timeVal)
                    .get();

                const conflict = aptDocs.docs.some(d => d.data().status !== 'CANCELLED');
                if (conflict) {
                    bot.sendMessage(chatId, '⚠️ Sorry, that time slot was just booked by someone else! Please choose another time with **📅 Book an Appointment**.', getMainMenu());
                    await SessionService.clearSession(chatId);
                    return;
                }

                const pDoc = await db.collection('patients').doc(targetPatientId).get();
                const patientName = pDoc.exists ? pDoc.data()?.name : (session.patientName || 'Patient');

                const aptRef = db.collection('appointments').doc();
                const newApt = {
                    patientId: targetPatientId,
                    patientName,
                    doctorId,
                    doctorName: session.booking_doc_name,
                    date: dateStr,
                    startTime: timeVal,
                    status: 'BOOKED',
                    source: 'TELEGRAM',
                    createdAt: new Date().toISOString()
                };

                await aptRef.set(newApt);
                await SessionService.clearSession(chatId);

                const confirmedMsg = `🎉 **Appointment Confirmed!**\n\n` +
                    `• **Patient**: ${newApt.patientName}\n` +
                    `• **Doctor**: Dr. ${newApt.doctorName}\n` +
                    `• **Date**: ${newApt.date}\n` +
                    `• **Time**: ${newApt.startTime}\n` +
                    `• **Status**: BOOKED\n\n` +
                    `Your appointment is confirmed. Check status anytime with **📊 Check Appointment / Token Status**.`;

                bot.sendMessage(chatId, confirmedMsg, {
                    parse_mode: 'Markdown',
                    ...getMainMenu()
                });
            } catch (e: any) {
                console.error('Booking confirmation failed:', e);
                bot.sendMessage(chatId, `⚠️ Booking failed: ${e.message}`, getMainMenu());
                await SessionService.clearSession(chatId);
            }
            return;
        } else {
            await SessionService.clearSession(chatId);
            bot.sendMessage(chatId, '❌ Appointment booking cancelled.', getMainMenu());
            return;
        }
    }
}
