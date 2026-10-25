import TelegramBot from 'node-telegram-bot-api';
import { TelegramSession, SessionService } from '../services/SessionService';
import { FamilyService } from '../services/FamilyService';
import { getMainMenu } from '../ui';

export async function handleStart(bot: TelegramBot, msg: TelegramBot.Message, session: TelegramSession) {
    const chatId = msg.chat.id;
    await SessionService.clearSession(chatId);

    // Register/update Telegram account metadata
    await FamilyService.ensureTelegramAccount(chatId, {
        username: msg.from?.username,
        firstName: msg.from?.first_name,
        lastName: msg.from?.last_name
    });

    const members = await FamilyService.getFamilyMembers(chatId);
    const active = await FamilyService.getActivePatient(chatId);

    if (active) {
        await SessionService.updateSession(chatId, {
            patientId: active.patientId,
            patientName: active.name
        });
    }

    let welcomeText = `🏥 **Welcome to ClinicQueue!**\n\n` +
        `You can manage appointments for yourself and your family members from this Telegram account.\n\n`;

    if (members.length > 0 && active) {
        welcomeText += `👨‍👩‍👧 **Family Accounts:** ${members.length} member(s) linked\n` +
            `👤 **Active Patient:** **${active.name}** (${active.relationship})\n\n`;
    } else {
        welcomeText += `To get started, tap **📝 Register a New Patient** below to add yourself or a family member.\n\n`;
    }

    welcomeText += `Please choose an option from the menu below:`;

    bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'Markdown',
        ...getMainMenu()
    });
}
