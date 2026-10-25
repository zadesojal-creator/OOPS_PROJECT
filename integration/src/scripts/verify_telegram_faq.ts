import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { handleFaq } from '../telegram/commands/faq';
import { SessionService } from '../telegram/services/SessionService';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string, detail: string = '') {
    if (condition) {
        console.log(`  ✅ PASS: ${testName} ${detail ? '(' + detail + ')' : ''}`);
        testsPassed++;
    } else {
        console.error(`  ❌ FAIL: ${testName} ${detail ? '(' + detail + ')' : ''}`);
        testsFailed++;
    }
}

// Mock TelegramBot to capture sent messages
class MockTelegramBot {
    sentMessages: { chatId: number | string; text: string; options?: any }[] = [];

    async sendMessage(chatId: number | string, text: string, options?: any) {
        this.sentMessages.push({ chatId, text, options });
        return { message_id: Date.now() };
    }

    clear() {
        this.sentMessages = [];
    }
}

async function runFaqVerification() {
    console.log('================================================================');
    console.log(' ClinicQueue Telegram FAQ Verification Suite                   ');
    console.log('================================================================\n');

    const mockBot = new MockTelegramBot() as any;
    const testChatId = 'TEST_FAQ_CHAT_' + Date.now();

    // 1. Enter FAQ via "❓ Help / Clinic FAQs" button
    console.log('--- 1. Enter FAQ via Main Menu Button ---');
    await SessionService.clearSession(testChatId);
    let session = await SessionService.getSession(testChatId);
    
    await handleFaq(mockBot, { chat: { id: testChatId }, text: '❓ Help / Clinic FAQs' } as any, session);
    
    assert(mockBot.sentMessages.length > 0, 'Bot sent response upon tapping "❓ Help / Clinic FAQs"');
    const welcomeMsg = mockBot.sentMessages[0]?.text || '';
    assert(welcomeMsg.includes('Clinic Information & AI Assistant'), 'Response introduces FAQ & AI assistant', welcomeMsg.slice(0, 45));
    
    session = await SessionService.getSession(testChatId);
    assert(session.state === 'FAQ_QUESTION', 'Session state transitioned to FAQ_QUESTION');

    // 2. Query Topic "Hospital Info"
    console.log('\n--- 2. Topic Query: "Hospital Info" ---');
    mockBot.clear();
    await handleFaq(mockBot, { chat: { id: testChatId }, text: 'Hospital Info' } as any, session);

    assert(mockBot.sentMessages.length >= 2, 'Bot sent searching message + knowledge answer');
    const answerMsg = mockBot.sentMessages[mockBot.sentMessages.length - 1]?.text || '';
    assert(answerMsg.toLowerCase().includes('clinicqueue'), 'Answer contains ClinicQueue hospital details');
    assert(mockBot.sentMessages[mockBot.sentMessages.length - 1]?.options?.reply_markup?.keyboard !== undefined, 'FAQ topics keyboard preserved for next question');

    session = await SessionService.getSession(testChatId);
    assert(session.state === 'FAQ_QUESTION', 'Session remains in FAQ_QUESTION mode');

    // 3. Query Topic "Doctors"
    console.log('\n--- 3. Topic Query: "Doctors" ---');
    mockBot.clear();
    await handleFaq(mockBot, { chat: { id: testChatId }, text: 'Doctors' } as any, session);

    const docAnswer = mockBot.sentMessages[mockBot.sentMessages.length - 1]?.text || '';
    assert(docAnswer.toLowerCase().includes('doctor') || docAnswer.toLowerCase().includes('specialization') || docAnswer.toLowerCase().includes('dr'), 'Answer contains physician roster / doctors list');

    // 4. Query Topic "Timings"
    console.log('\n--- 4. Topic Query: "Timings" ---');
    mockBot.clear();
    await handleFaq(mockBot, { chat: { id: testChatId }, text: 'Timings' } as any, session);

    const timeAnswer = mockBot.sentMessages[mockBot.sentMessages.length - 1]?.text || '';
    assert(timeAnswer.toLowerCase().includes('hours') || timeAnswer.toLowerCase().includes('opd') || timeAnswer.toLowerCase().includes('am'), 'Answer contains operating hours');

    // 5. Query Topic "Fees"
    console.log('\n--- 5. Topic Query: "Fees" ---');
    mockBot.clear();
    await handleFaq(mockBot, { chat: { id: testChatId }, text: 'Fees' } as any, session);

    const feeAnswer = mockBot.sentMessages[mockBot.sentMessages.length - 1]?.text || '';
    assert(feeAnswer.includes('$') || feeAnswer.toLowerCase().includes('fee') || feeAnswer.toLowerCase().includes('consultation'), 'Answer contains fee structure');

    // 6. Free-form question asking about cardiology
    console.log('\n--- 6. Free-form Question: "Do you have ECG facilities?" ---');
    mockBot.clear();
    await handleFaq(mockBot, { chat: { id: testChatId }, text: 'Do you have ECG facilities?' } as any, session);

    const customAnswer = mockBot.sentMessages[mockBot.sentMessages.length - 1]?.text || '';
    assert(customAnswer.length > 20, 'Free-form AI query returned answer', customAnswer.slice(0, 60));

    // 7. Exit FAQ via "🔙 Main Menu"
    console.log('\n--- 7. Exit FAQ via "🔙 Main Menu" ---');
    mockBot.clear();
    await handleFaq(mockBot, { chat: { id: testChatId }, text: '🔙 Main Menu' } as any, session);

    assert(mockBot.sentMessages.length === 1, 'Bot sent main menu confirmation');
    assert(mockBot.sentMessages[0]?.text.includes('main menu'), 'Message confirms return to main menu');
    
    session = await SessionService.getSession(testChatId);
    assert(session.state === 'IDLE', 'Session state cleared back to IDLE');

    // Clean up
    await SessionService.clearSession(testChatId);

    console.log('\n================================================================');
    console.log(` FAQ VERIFICATION SUMMARY: ${testsPassed} PASSED, ${testsFailed} FAILED`);
    console.log('================================================================');

    if (testsFailed > 0) {
        process.exit(1);
    }
}

runFaqVerification().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
