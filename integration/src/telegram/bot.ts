import TelegramBot from 'node-telegram-bot-api';
import { SessionService } from './services/SessionService';
import { FamilyService } from './services/FamilyService';
import { handleStart } from './commands/start';
import {
    handleRegister,
    processFamilyRegistration,
    handleFamilyMembers,
    handleSelectPatient,
    processSelectPatient,
    processLinkCode,
    handleMyDetails
} from './workflows/RegistrationWorkflow';
import { handleBook, processBooking } from './workflows/BookingWorkflow';
import { handleFaq } from './commands/faq';
import { handleQueue } from './workflows/QueueWorkflow';
import { IntentRouter } from './services/IntentRouter';
import { db } from '../firebase/admin';
import { getMainMenu } from './ui';

let botInstance: TelegramBot | null = null;

export function getBot(): TelegramBot | null {
    if (!botInstance && process.env.TELEGRAM_BOT_TOKEN) {
        try {
            botInstance = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
        } catch (e) {
            console.error('Failed to instantiate fallback TelegramBot:', e);
        }
    }
    return botInstance;
}

export function initializeBot(): TelegramBot | null {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.warn('TELEGRAM_BOT_TOKEN not found. Telegram bot disabled.');
        return null;
    }

    const bot = new TelegramBot(token, { polling: true });
    botInstance = bot;

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = (msg.text || '').trim();
        const lowered = text.toLowerCase();

        try {
            console.log(`[Telegram] Message from ${chatId}: "${text}" (contact=${!!msg.contact})`);

            // Health ping
            if (text === '/ping') {
                bot.sendMessage(chatId, 'pong! The bot is alive.');
                return;
            }

            // Deduplicate per chat
            const updateKey = `${chatId}_${msg.message_id}`;
            const updateRef = db.collection('telegramUpdates').doc(updateKey);
            const updateDoc = await updateRef.get();
            if (updateDoc.exists) return;
            await updateRef.set({ processedAt: new Date().toISOString() });

            // Handle /link <code> command or direct 6-digit code
            const codeMatch = text.match(/^\/link\s+([0-9]{6})$/i) || text.match(/^([0-9]{6})$/);
            if (codeMatch) {
                await processLinkCode(bot, msg, { state: 'FAM_LINK_CODE' });
                return;
            }

            const session = await SessionService.getSession(chatId);

            // Global Cancel
            if (text === '🔙 Cancel' || text === '❌ Cancel' || text === '🔙 Main Menu' || lowered === 'cancel') {
                await SessionService.clearSession(chatId);
                const cancelMsg = text === '🔙 Main Menu' ? 'Returned to main menu.' : 'Operation cancelled.';
                bot.sendMessage(chatId, cancelMsg, getMainMenu());
                return;
            }

            // Contact sharing (for registration)
            if (msg.contact && msg.contact.phone_number) {
                await processFamilyRegistration(bot, msg, session);
                return;
            }

            // State Machine continuation (Active workflows take priority)
            if (session.state.startsWith('FAM_REG_')) {
                await processFamilyRegistration(bot, msg, session);
                return;
            }
            if (session.state === 'FAM_SELECT_ACTIVE') {
                await processSelectPatient(bot, msg, session);
                return;
            }
            if (session.state === 'FAM_LINK_CODE') {
                await processLinkCode(bot, msg, session);
                return;
            }
            if (session.state.startsWith('BOOKING_')) {
                await processBooking(bot, msg, session);
                return;
            }
            if (session.state === 'FAQ_QUESTION') {
                await handleFaq(bot, msg, session);
                return;
            }

            // Command & Button routing
            if (lowered === '/start' || lowered === 'start' || lowered === 'menu') {
                await handleStart(bot, msg, session);
                return;
            }

            // 1. Register a New Patient
            if (text === '📝 Register a New Patient' || text === 'Register a New Patient' || text === '📝 Register Patient' || lowered === '/register' || lowered === 'register') {
                await handleRegister(bot, msg, session);
                return;
            }

            // 2. Select an Existing Patient
            if (text === '👤 Select an Existing Patient' || text === 'Select an Existing Patient' || lowered === '/select' || lowered === 'select patient') {
                await handleSelectPatient(bot, msg, session);
                return;
            }

            // 3. My Family Members
            if (text === '👨‍👩‍👧 My Family Members' || text === 'My Family Members' || lowered === '/family' || lowered === 'family') {
                await handleFamilyMembers(bot, msg, session);
                return;
            }

            // 4. Book an Appointment
            if (text === '📅 Book an Appointment' || text === 'Book an Appointment' || text === '📅 Book Appointment' || lowered === '/book' || lowered === 'book') {
                await handleBook(bot, msg, session);
                return;
            }

            // 5. Check Appointment / Token Status
            if (text === '📊 Check Appointment / Token Status' || text === 'Check Appointment / Token Status' || text === '📊 Token Status' || lowered === '/token' || lowered === 'token') {
                await handleQueue(bot, msg, session, 'STATUS');
                return;
            }

            // 6. Request Walk-in Token
            if (text === '🎫 Request Token' || lowered === 'request token' || lowered === 'book token' || lowered === '/queue' || lowered === 'queue') {
                await handleQueue(bot, msg, session, 'REQUEST');
                return;
            }

            // 7. Cancel Token
            if (text === '❌ Cancel Token' || lowered === 'cancel token' || lowered === '/cancel_token') {
                await handleQueue(bot, msg, session, 'CANCEL');
                return;
            }

            // 8. Help / Clinic FAQs & Topics
            const faqTopics = ['hospital info', 'doctors', 'departments', 'timings', 'services', 'fees', 'location', 'emergency info'];
            if (
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
                faqTopics.includes(lowered)
            ) {
                await handleFaq(bot, msg, session);
                return;
            }

            // 9. My Profile Details
            if (text === '👤 My Details' || lowered === 'my details' || lowered === '/me') {
                await handleMyDetails(bot, msg, session);
                return;
            }

            // 10. Modern Natural Language Understanding & Intelligent Routing
            await IntentRouter.routeMessage(bot, msg, session);

        } catch (error: any) {
            console.error('[Telegram] Error processing update:', error);
            bot.sendMessage(chatId, '⚠️ An unexpected error occurred. Tap below to return to the main menu.', getMainMenu());
        }
    });

    console.log('Telegram Bot initialized with Family Registration and listening for updates.');
    return bot;
}
