import TelegramBot from 'node-telegram-bot-api';
import { TelegramSession, SessionService } from '../services/SessionService';
import { FamilyService, FamilyMemberRecord } from '../services/FamilyService';
import { db } from '../../firebase/admin';
import { CppEngine } from '../../cpp-adapter/CppEngine';
import { getMainMenu } from '../ui';

export async function handleQueue(
    bot: TelegramBot,
    msg: TelegramBot.Message,
    session: TelegramSession,
    action: 'REQUEST' | 'STATUS' | 'CANCEL'
) {
    const chatId = msg.chat.id;
    const members = await FamilyService.getFamilyMembers(chatId);

    if (members.length === 0) {
        bot.sendMessage(chatId, '⚠️ You must register a patient first before using clinic queue operations. Please tap **📝 Register a New Patient** below:', {
            parse_mode: 'Markdown',
            ...getMainMenu()
        });
        return;
    }

    const active = await FamilyService.getActivePatient(chatId) || members[0];
    const today = new Date().toISOString().split('T')[0];

    // 1. STATUS CHECK (Appointments & Tokens across family members)
    if (action === 'STATUS') {
        const queueSnap = await db.collection('queue').get();
        const aptsSnap = await db.collection('appointments').get();

        const todayQueue = queueSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter(t => (t.createdAt || '').startsWith(today));

        const allApts = aptsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

        let report = `📊 **Clinic Status Overview**\n\n`;
        let foundAny = false;

        for (const m of members) {
            const memberToken = todayQueue.find(t => t.patientId === m.patientId && (t.status === 'WAITING' || t.status === 'CALLED'));
            const memberUpcomingApts = allApts.filter(a => a.patientId === m.patientId && a.date >= today && a.status !== 'CANCELLED');

            if (memberToken || memberUpcomingApts.length > 0) {
                foundAny = true;
                report += `👤 **${m.name}** (${m.relationship}):\n`;

                if (memberToken) {
                    if (memberToken.status === 'CALLED') {
                        report += `   🚨 **TOKEN CALLED!** Token \`${memberToken.tokenNumber}\` — Please proceed to consultation room immediately.\n`;
                    } else {
                        // Calculate position in queue
                        const waitingTokens = todayQueue.filter(t => t.status === 'WAITING');
                        let pos = 1;
                        try {
                            const orderedRes = await CppEngine.execute('orderQueue', { tokens: waitingTokens });
                            const idx = (orderedRes.ordered || []).findIndex((t: any) => t.id === memberToken.id);
                            if (idx >= 0) pos = idx + 1;
                        } catch {
                            pos = 1;
                        }
                        report += `   🎫 **Live Token:** \`${memberToken.tokenNumber}\` · Status: WAITING · Position: **#${pos}** in line\n`;
                    }
                }

                if (memberUpcomingApts.length > 0) {
                    memberUpcomingApts.forEach(a => {
                        report += `   📅 **Appointment:** ${a.date} at ${a.startTime} with Dr. ${a.doctorName} (${a.status})\n`;
                    });
                }
                report += `\n`;
            }
        }

        if (!foundAny) {
            report += `ℹ️ No active queue tokens or upcoming appointments found for your family today.\n\n` +
                `Active patient: **${active.name}** (${active.relationship})\n\n` +
                `You can tap **📅 Book an Appointment** or **🎫 Request Token** below to get scheduled:`;
        }

        bot.sendMessage(chatId, report, {
            parse_mode: 'Markdown',
            ...getMainMenu()
        });
        return;
    }

    // 2. REQUEST TOKEN (Walk-in Token)
    if (action === 'REQUEST') {
        const targetPatientId = session.patientId || active.patientId;
        const pDoc = await db.collection('patients').doc(targetPatientId).get();
        const patientData = pDoc.exists ? pDoc.data()! : { name: active.name, age: active.age };

        const queueSnap = await db.collection('queue').get();
        const activeTokens = queueSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter(t => t.patientId === targetPatientId && (t.status === 'WAITING' || t.status === 'CALLED') && (t.createdAt || '').startsWith(today));

        if (activeTokens.length > 0) {
            const current = activeTokens[0];
            bot.sendMessage(chatId, `⚠️ **${patientData.name}** already has an active token for today:\n\n• **Token**: \`${current.tokenNumber}\`\n• **Status**: ${current.status}`, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
            return;
        }

        const priority = (patientData.age && Number(patientData.age) >= 60) ? 'SENIOR' : 'NORMAL';
        const now = new Date();
        const todayTokensCount = queueSnap.docs.filter(d => (d.data().createdAt || '').startsWith(today)).length;
        const tokenNumber = `T-${todayTokensCount + 1}`;

        const tokenRef = db.collection('queue').doc();
        const tokenData = {
            tokenNumber,
            patientId: targetPatientId,
            patientName: patientData.name,
            priority,
            status: 'WAITING',
            createdAt: now.toISOString(),
            createdBy: 'telegram_family'
        };

        await tokenRef.set(tokenData);

        bot.sendMessage(chatId, `🎫 **Walk-in Queue Token Confirmed!**\n\n` +
            `• **Patient:** **${patientData.name}**\n` +
            `• **Token Number:** \`${tokenNumber}\`\n` +
            `• **Priority:** ${priority}\n` +
            `• **Status:** WAITING\n\n` +
            `Please proceed to the clinic waiting lounge. You can track your position anytime by tapping **📊 Check Appointment / Token Status**.`, {
            parse_mode: 'Markdown',
            ...getMainMenu()
        });
        return;
    }

    // 3. CANCEL TOKEN
    if (action === 'CANCEL') {
        const targetPatientId = session.patientId || active.patientId;
        const queueSnap = await db.collection('queue').where('patientId', '==', targetPatientId).get();
        const activeTokens = queueSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as any))
            .filter(t => t.status === 'WAITING' && (t.createdAt || '').startsWith(today));

        if (activeTokens.length === 0) {
            bot.sendMessage(chatId, 'ℹ️ No active waiting token found to cancel.', getMainMenu());
            return;
        }

        for (const t of activeTokens) {
            await db.collection('queue').doc(t.id).update({
                status: 'CANCELLED',
                cancelledAt: new Date().toISOString()
            });
        }

        bot.sendMessage(chatId, '✅ Your active queue token has been cancelled.', getMainMenu());
        return;
    }
}
