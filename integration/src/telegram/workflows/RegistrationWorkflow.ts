import TelegramBot from 'node-telegram-bot-api';
import { TelegramSession, SessionService } from '../services/SessionService';
import { FamilyService, FamilyMemberRecord } from '../services/FamilyService';
import { db } from '../../firebase/admin';
import {
    getMainMenu,
    getRegisterPhoneMenu,
    getGenderMenu,
    getRelationshipMenu,
    getRegistrationConfirmMenu,
    getPostRegistrationMenu,
    getCancelMenu
} from '../ui';

function digitsOnly(value: string): string {
    return (value || '').replace(/\D/g, '');
}

/**
 * Initiates the registration of a new patient / family member.
 */
export async function handleRegister(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;

    await SessionService.updateSession(chatId, {
        state: 'FAM_REG_NAME',
        fam_name: null,
        fam_age: null,
        fam_gender: null,
        fam_phone: null,
        fam_relationship: null
    });

    bot.sendMessage(chatId, `📝 **Register a New Patient (Step 1/5)**\n\nPlease enter the patient's **full name** (between 2 and 120 characters):`, {
        parse_mode: 'Markdown',
        ...getCancelMenu()
    });
}

/**
 * Handles the step-by-step family registration state machine.
 */
export async function processFamilyRegistration(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const lowered = text.toLowerCase();

    // Global Cancel
    if (lowered === 'cancel' || text === '🔙 Cancel' || text === '❌ Cancel' || text === '/cancel') {
        await SessionService.clearSession(chatId);
        bot.sendMessage(chatId, '❌ Registration cancelled.', getMainMenu());
        return;
    }

    // STEP 1: Full Name
    if (session.state === 'FAM_REG_NAME') {
        if (text.length < 2 || text.length > 120) {
            bot.sendMessage(chatId, '⚠️ Please enter a valid name between 2 and 120 characters:', getCancelMenu());
            return;
        }

        await SessionService.updateSession(chatId, {
            state: 'FAM_REG_AGE',
            fam_name: text
        });

        bot.sendMessage(chatId, `Recorded name: **${text}**\n\n🎂 **Register a New Patient (Step 2/5)**\n\nWhat is ${text}'s **age**? (Enter a number between 0 and 130):`, {
            parse_mode: 'Markdown',
            ...getCancelMenu()
        });
        return;
    }

    // STEP 2: Age
    if (session.state === 'FAM_REG_AGE') {
        const age = parseInt(text, 10);
        if (isNaN(age) || age < 0 || age > 130) {
            bot.sendMessage(chatId, '⚠️ Please enter a valid age as a whole number between 0 and 130:', getCancelMenu());
            return;
        }

        await SessionService.updateSession(chatId, {
            state: 'FAM_REG_GENDER',
            fam_age: age
        });

        bot.sendMessage(chatId, `Recorded age: **${age}**\n\n⚧️ **Register a New Patient (Step 3/5)**\n\nWhat is the patient's **gender**? Please select an option:`, {
            parse_mode: 'Markdown',
            ...getGenderMenu()
        });
        return;
    }

    // STEP 3: Gender
    if (session.state === 'FAM_REG_GENDER') {
        let gender = '';
        if (lowered === 'female') gender = 'Female';
        else if (lowered === 'male') gender = 'Male';
        else if (lowered === 'other') gender = 'Other';

        if (!gender) {
            bot.sendMessage(chatId, '⚠️ Please select Female, Male, or Other:', getGenderMenu());
            return;
        }

        await SessionService.updateSession(chatId, {
            state: 'FAM_REG_PHONE',
            fam_gender: gender
        });

        bot.sendMessage(chatId, `Recorded gender: **${gender}**\n\n📱 **Register a New Patient (Step 4/5)**\n\nPlease share or enter the **contact phone number** for this patient (e.g. +91 98765 43210):\n\n*(Family members may share the same phone number)*`, {
            parse_mode: 'Markdown',
            ...getRegisterPhoneMenu()
        });
        return;
    }

    // STEP 4: Phone Number
    if (session.state === 'FAM_REG_PHONE') {
        let rawPhone = '';
        if (msg.contact && msg.contact.phone_number) {
            rawPhone = msg.contact.phone_number.trim();
        } else if (text) {
            const digits = digitsOnly(text);
            if (digits.length >= 7 && digits.length <= 15) {
                rawPhone = text;
            }
        }

        if (!rawPhone || digitsOnly(rawPhone).length < 7) {
            bot.sendMessage(chatId, '⚠️ Please share your phone number using the button below or enter a valid number (at least 7 digits):', getRegisterPhoneMenu());
            return;
        }

        if (!rawPhone.startsWith('+') && !rawPhone.startsWith('0')) {
            rawPhone = '+' + rawPhone;
        }

        await SessionService.updateSession(chatId, {
            state: 'FAM_REG_RELATIONSHIP',
            fam_phone: rawPhone
        });

        bot.sendMessage(chatId, `Recorded phone: **${rawPhone}**\n\n👥 **Register a New Patient (Step 5/5)**\n\nWhat is the patient's **relationship** to you (the account holder)?`, {
            parse_mode: 'Markdown',
            ...getRelationshipMenu()
        });
        return;
    }

    // STEP 5: Relationship
    if (session.state === 'FAM_REG_RELATIONSHIP') {
        const validRel = ['self', 'spouse', 'child', 'parent', 'sibling', 'other'];
        let matchedRel = 'Other';
        for (const r of validRel) {
            if (lowered === r) {
                matchedRel = r.charAt(0).toUpperCase() + r.slice(1);
                break;
            }
        }
        if (text && !validRel.includes(lowered)) {
            matchedRel = text.trim();
        }

        await SessionService.updateSession(chatId, {
            state: 'FAM_REG_CONFIRM',
            fam_relationship: matchedRel
        });

        const currentSession = await SessionService.getSession(chatId);
        const summaryName = currentSession.fam_name || session.fam_name || 'Patient';
        const summaryAge = currentSession.fam_age ?? session.fam_age ?? '—';
        const summaryGender = currentSession.fam_gender || session.fam_gender || '—';
        const summaryPhone = currentSession.fam_phone || session.fam_phone || '—';

        const summary = `📋 **Patient Registration Confirmation Summary**\n\n` +
            `• **Full Name:** ${summaryName}\n` +
            `• **Age:** ${summaryAge} years\n` +
            `• **Gender:** ${summaryGender}\n` +
            `• **Contact Phone:** ${summaryPhone}\n` +
            `• **Relationship:** ${matchedRel}\n` +
            `• **Telegram Family Account:** Chat ID \`${chatId}\`\n\n` +
            `Please review the details above and tap **✅ Confirm & Save** to create this clinic record:`;

        bot.sendMessage(chatId, summary, {
            parse_mode: 'Markdown',
            ...getRegistrationConfirmMenu()
        });
        return;
    }

    // STEP 6: Confirmation & Saving
    if (session.state === 'FAM_REG_CONFIRM') {
        if (text === '✅ Confirm & Save' || lowered === 'confirm' || lowered === 'yes' || lowered === 'save') {
            try {
                // Ensure fresh session values
                const currentSession = await SessionService.getSession(chatId);
                const regName = currentSession.fam_name || session.fam_name;
                const regAge = currentSession.fam_age ?? session.fam_age;
                const regGender = currentSession.fam_gender || session.fam_gender;
                const regPhone = currentSession.fam_phone || session.fam_phone;
                const regRel = currentSession.fam_relationship || session.fam_relationship || 'Self';

                if (!regName) {
                    bot.sendMessage(chatId, '⚠️ Registration session expired or details were incomplete. Please tap **📝 Register a New Patient** below to try again:', getMainMenu());
                    await SessionService.clearSession(chatId);
                    return;
                }

                const result = await FamilyService.addFamilyMember(chatId, {
                    name: regName,
                    age: Number(regAge) || 0,
                    gender: regGender || 'Other',
                    phone: regPhone || '',
                    relationship: regRel
                });

                await SessionService.updateSession(chatId, {
                    state: 'IDLE',
                    patientId: result.patientId,
                    patientName: result.patient.name,
                    fam_name: null,
                    fam_age: null,
                    fam_gender: null,
                    fam_phone: null,
                    fam_relationship: null
                });

                const successMsg = `🎉 **Patient Registered Successfully!**\n\n` +
                    `**${result.patient.name}** (${regRel}) has been saved with canonical Patient ID: \`${result.patientId}\`.\n\n` +
                    `This patient is now set as the active patient for bookings and will automatically receive digital prescriptions directly in this chat.\n\n` +
                    `What would you like to do next?`;

                bot.sendMessage(chatId, successMsg, {
                    parse_mode: 'Markdown',
                    ...getPostRegistrationMenu(result.patient.name)
                });
            } catch (err: any) {
                console.error('Error saving family member:', err);
                bot.sendMessage(chatId, `⚠️ Failed to save patient registration: ${err.message || 'Unknown error'}. Please try again with /start.`);
                await SessionService.clearSession(chatId);
            }
            return;
        }

        bot.sendMessage(chatId, 'Please tap **✅ Confirm & Save** or **❌ Cancel** below:', getRegistrationConfirmMenu());
        return;
    }
}

/**
 * Lists all family members under this Telegram chat.
 */
export async function handleFamilyMembers(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    const members = await FamilyService.getFamilyMembers(chatId);
    const active = await FamilyService.getActivePatient(chatId);

    if (members.length === 0) {
        bot.sendMessage(chatId, `👨‍👩‍👧 **No Family Members Found**\n\nYou do not have any family members registered under this Telegram account yet.\n\nTap **📝 Register a New Patient** below to add yourself or a relative:`, {
            parse_mode: 'Markdown',
            ...getMainMenu()
        });
        return;
    }

    let text = `👨‍👩‍👧 **Your Registered Family Members (${members.length}):**\n\n`;
    members.forEach((m, idx) => {
        const isActive = active?.patientId === m.patientId;
        const star = isActive ? ' ⭐ *(Active for booking)*' : '';
        text += `${idx + 1}. **${m.name}** (${m.relationship}, Age: ${m.age || '—'}, ${m.gender || '—'})${star}\n   📱 Phone: ${m.phone || '—'} · ID: \`${m.patientId}\`\n\n`;
    });

    text += `To book an appointment for a specific member, tap **👤 Select an Existing Patient** or **📅 Book an Appointment** below:`;

    bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...getMainMenu()
    });
}

/**
 * Allows user to select which family member is active for bookings, or link an existing record with a code.
 */
export async function handleSelectPatient(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    const members = await FamilyService.getFamilyMembers(chatId);

    const keyboard: TelegramBot.KeyboardButton[][] = [];

    if (members.length > 0) {
        members.forEach(m => {
            keyboard.push([{ text: `👤 ${m.name} (${m.relationship})` }]);
        });
    }

    keyboard.push([{ text: "➕ Register a New Patient" }]);
    keyboard.push([{ text: "🔗 Link with 6-Digit Code" }]);
    keyboard.push([{ text: "🔙 Cancel" }]);

    await SessionService.updateSession(chatId, {
        state: 'FAM_SELECT_ACTIVE'
    });

    bot.sendMessage(chatId, `👤 **Select Patient for Clinic Operations**\n\nChoose the family member you wish to manage for appointments and medical records, or enter a portal linking code:`, {
        parse_mode: 'Markdown',
        reply_markup: { keyboard, resize_keyboard: true }
    });
}

/**
 * Processes the selection of an active family member or portal code linking.
 */
export async function processSelectPatient(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const lowered = text.toLowerCase();

    if (lowered === 'cancel' || text === '🔙 Cancel' || text === '/cancel') {
        await SessionService.clearSession(chatId);
        bot.sendMessage(chatId, 'Operation cancelled.', getMainMenu());
        return;
    }

    if (text === '➕ Register a New Patient' || text === '📝 Register a New Patient') {
        await handleRegister(bot, msg, session);
        return;
    }

    if (text === '🔗 Link with 6-Digit Code' || lowered.startsWith('/link')) {
        await SessionService.updateSession(chatId, { state: 'FAM_LINK_CODE' });
        bot.sendMessage(chatId, `🔐 **Link Existing Patient Profile**\n\nPlease enter the **6-digit verification code** generated from your ClinicQueue Patient Portal (or type /link 123456):\n\n*(This protects medical confidentiality and prevents unauthorized linking)*`, {
            parse_mode: 'Markdown',
            ...getCancelMenu()
        });
        return;
    }

    // Check which member was clicked
    const members = await FamilyService.getFamilyMembers(chatId);
    let chosen: FamilyMemberRecord | null = null;

    for (const m of members) {
        if (text === `👤 ${m.name} (${m.relationship})` || text.toLowerCase().includes(m.name.toLowerCase())) {
            chosen = m;
            break;
        }
    }

    // Number index check
    const num = parseInt(text, 10);
    if (!chosen && !isNaN(num) && num >= 1 && num <= members.length) {
        chosen = members[num - 1];
    }

    if (chosen) {
        await FamilyService.setActivePatient(chatId, chosen.patientId);
        await SessionService.updateSession(chatId, {
            state: 'IDLE',
            patientId: chosen.patientId,
            patientName: chosen.name
        });

        bot.sendMessage(chatId, `✅ Active patient set to **${chosen.name}** (${chosen.relationship})!\n\nAll appointments, live queue tokens, and digital prescriptions will now be managed for ${chosen.name}.`, {
            parse_mode: 'Markdown',
            ...getMainMenu()
        });
        return;
    }

    bot.sendMessage(chatId, '⚠️ Please select a family member from the menu below or tap **🔙 Cancel**:');
}

/**
 * Handles entering a 6-digit linking code to attach an existing clinic patient to this family account.
 */
export async function processLinkCode(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (text === '🔙 Cancel' || text.toLowerCase() === 'cancel') {
        await SessionService.clearSession(chatId);
        bot.sendMessage(chatId, 'Linking cancelled.', getMainMenu());
        return;
    }

    const codeMatch = text.match(/^\/link\s+([0-9]{6})$/i) || text.match(/^([0-9]{6})$/);
    if (!codeMatch) {
        bot.sendMessage(chatId, '⚠️ Please enter a valid 6-digit code (e.g. 123456) or tap **🔙 Cancel**:', getCancelMenu());
        return;
    }

    const code = codeMatch[1];
    const linkDoc = await db.collection('telegramLinkCodes').doc(code).get();

    if (!linkDoc.exists) {
        bot.sendMessage(chatId, '⚠️ Linking code not found or invalid. Please generate a code in the Patient Portal.', getMainMenu());
        await SessionService.clearSession(chatId);
        return;
    }

    const linkData = linkDoc.data()!;
    const now = new Date().toISOString();

    if (linkData.expiresAt <= now) {
        await db.collection('telegramLinkCodes').doc(code).delete();
        bot.sendMessage(chatId, '⚠️ This linking code has expired. Please generate a fresh code in your Patient Portal.', getMainMenu());
        await SessionService.clearSession(chatId);
        return;
    }

    const patientId = linkData.patientId;
    const pDoc = await db.collection('patients').doc(patientId).get();
    const patientName = pDoc.exists ? pDoc.data()?.name : 'Patient';

    // Link existing patient into family account
    await FamilyService.linkExistingPatient(chatId, patientId, 'Self');
    await db.collection('telegramLinkCodes').doc(code).delete();

    await SessionService.updateSession(chatId, {
        state: 'IDLE',
        patientId,
        patientName
    });

    bot.sendMessage(chatId, `🎉 **Account Linked Successfully!**\n\n**${patientName}** has been securely connected to this Telegram family account.\n\nYou will automatically receive digital prescriptions and queue updates directly here!`, {
        parse_mode: 'Markdown',
        ...getMainMenu()
    });
}

/**
 * Displays details of the currently active patient profile.
 */
export async function handleMyDetails(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    const active = await FamilyService.getActivePatient(chatId);

    if (!active) {
        bot.sendMessage(chatId, `👤 You do not have any active patient registered yet.\n\nPlease tap **📝 Register a New Patient** below:`, {
            parse_mode: 'Markdown',
            ...getMainMenu()
        });
        return;
    }

    const pDoc = await db.collection('patients').doc(active.patientId).get();
    const data = pDoc.exists ? pDoc.data()! : {};

    const detailsMsg = `👤 **Active Patient Profile**\n\n` +
        `• **Name:** ${data.name || active.name}\n` +
        `• **Relationship:** ${active.relationship}\n` +
        `• **Phone:** ${data.phone || '—'}\n` +
        `• **Age:** ${data.age || '—'} years\n` +
        `• **Gender:** ${data.gender || '—'}\n` +
        `• **Patient ID:** \`${active.patientId}\`\n` +
        `• **Telegram Linked:** ✅ Active (Chat ID: \`${chatId}\`)\n\n` +
        `To switch patient, tap **👤 Select an Existing Patient** below.`;

    bot.sendMessage(chatId, detailsMsg, {
        parse_mode: 'Markdown',
        ...getMainMenu()
    });
}
