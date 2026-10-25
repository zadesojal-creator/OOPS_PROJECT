import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { IntentRouter } from '../telegram/services/IntentRouter';
import { SessionService } from '../telegram/services/SessionService';
import { FamilyService } from '../telegram/services/FamilyService';
import { db } from '../firebase/admin';

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

class MockTelegramBot {
    sentMessages: { chatId: number | string; text: string; options?: any }[] = [];

    async sendMessage(chatId: number | string, text: string, options?: any) {
        this.sentMessages.push({ chatId, text, options });
        return { message_id: Date.now() };
    }

    clear() {
        this.sentMessages = [];
    }

    lastMessage(): string {
        return this.sentMessages[this.sentMessages.length - 1]?.text || '';
    }
}

async function runVerification() {
    console.log('================================================================');
    console.log(' ClinicQueue Telegram AI Modernization Verification Suite      ');
    console.log('================================================================\n');

    const mockBot = new MockTelegramBot() as any;
    const testChatId = 'TEST_MODERN_CHAT_' + Date.now();

    // Setup a clean session and mock family account
    await SessionService.clearSession(testChatId);
    await FamilyService.ensureTelegramAccount(testChatId, {
        firstName: 'Alex',
        lastName: 'Taylor',
        username: 'alextaylor'
    });

    // 1. Test Greeting
    console.log('--- 1. Natural Language Greeting ("hi, can you help me?") ---');
    mockBot.clear();
    let session = await SessionService.getSession(testChatId);
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, from: { first_name: 'Alex' }, text: 'hi, can you help me?' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to greeting');
    let lastMsg = mockBot.lastMessage();
    assert(lastMsg.toLowerCase().includes('welcome to clinicqueue') || lastMsg.toLowerCase().includes('hello'), 'Polite conversational greeting sent', lastMsg.slice(0, 40));
    assert(!lastMsg.includes('To get started, tap 📝 Register a New Patient'), 'Does not dump cold registration menu on simple greeting');

    // 2. Test Emergency Detection & Advisory
    console.log('\n--- 2. Medical Emergency Detection ("I am having severe chest pain") ---');
    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'I am having severe chest pain and can not breathe' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied immediately to emergency');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.includes('EMERGENCY MEDICAL ADVISORY'), 'Immediate emergency advisory triggered');
    assert(lastMsg.includes('+1 (555) 019-3637') || lastMsg.includes('019-EMERGENCY'), 'Provides 24/7 emergency telephone hotline');
    assert(lastMsg.includes('24 Hours / 7 Days'), 'Mentions 24/7 ER availability');

    // 3. Test Hospital Operating Hours & Sunday Timings
    console.log('\n--- 3. Operating Hours Query ("what time do you open?") ---');
    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'what time do you open tomorrow and is Sunday open?' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to timings inquiry');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.includes('08:30 AM to 08:30 PM'), 'Specifies authoritative Monday to Saturday OPD hours');
    assert(lastMsg.includes('Sunday Special OPD') || lastMsg.includes('09:00 AM to 01:00 PM'), 'Specifies Sunday Special OPD schedule');
    assert(lastMsg.includes('24 Hours / 7 Days'), 'Specifies 24/7 Emergency & Urgent care');

    // 4. Test Consultation Fees
    console.log('\n--- 4. Consultation Charges Query ("how much does it cost?") ---');
    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'what are your consultation fees and charges?' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to fee inquiry');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.includes('$35'), 'Mentions authoritative $35 General Physician fee');
    assert(lastMsg.includes('Follow-up within 7 days') || lastMsg.includes('discounted rate'), 'Mentions follow-up discount policy');
    assert(lastMsg.includes('Payment Modes') || lastMsg.includes('Insurance'), 'Mentions accepted payment modes and insurance');

    // 5. Test Specialist Fee ("how much does it cost to see a skin doctor?")
    console.log('\n--- 5. Specialist Fee Query ("cost to see a skin doctor") ---');
    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'how much does it cost to see a skin doctor?' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to specialist fee inquiry');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.includes('Dermatologist Consultation') || lastMsg.includes('$50') || lastMsg.includes('Specialist'), 'Recognizes Dermatologist specialty fee');

    // 6. Test Hospital Location & Directions
    console.log('\n--- 6. Hospital Location Query ("where are you located?") ---');
    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'where is the clinic located and what is the address?' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to location inquiry');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.includes('42 Metro Wellness Boulevard') || lastMsg.includes('Health City'), 'Provides exact authoritative clinic address');
    assert(lastMsg.includes('Central Metro Station') || lastMsg.includes('Landmark'), 'Provides metro landmark reference');

    // 7. Test Doctor Information
    console.log('\n--- 7. Doctor Information Query ("who are your doctors?") ---');
    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'who are the doctors available at ClinicQueue?' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to doctor inquiry');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.includes('Clinical Team') || lastMsg.includes('Dr.'), 'Lists available clinical physicians');

    // 8. Test Symptom Guidance ("I have a skin rash on my arms")
    console.log('\n--- 8. Symptom Description Guidance ("I have a skin rash") ---');
    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'I have a red skin rash on my arms for two days' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to symptom description');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.includes('Dermatologist'), 'Accurately recommends Dermatologist department');
    assert(lastMsg.includes('Book an Appointment') || lastMsg.includes('Request Token'), 'Offers immediate appointment booking or token intake');

    // 9. Test Thanks & Goodbye
    console.log('\n--- 9. Polite Closures ("thank you for helping me" & "bye") ---');
    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'thank you for helping me' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to gratitude');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.toLowerCase().includes('welcome'), 'Polite gratitude acknowledgment sent');

    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'bye, take care' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to goodbye');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.toLowerCase().includes('goodbye') || lastMsg.toLowerCase().includes('take care'), 'Polite farewell sent');

    // 10. Test Clarification on Ambiguous Input
    console.log('\n--- 10. Ambiguous Input Clarification ---');
    mockBot.clear();
    await IntentRouter.routeMessage(
        mockBot,
        { chat: { id: testChatId }, text: 'asdfqwerty 12345' } as any,
        session
    );
    assert(mockBot.sentMessages.length > 0, 'Bot replied to ambiguous input');
    lastMsg = mockBot.lastMessage();
    assert(lastMsg.includes('assist you correctly') || lastMsg.includes('help you with'), 'Polite clarification options presented');

    // Summary
    console.log('\n================================================================');
    console.log(` Verification Suite Completed: ${testsPassed} PASSED, ${testsFailed} FAILED`);
    console.log('================================================================\n');

    if (testsFailed > 0) {
        process.exit(1);
    }
}

runVerification().catch(err => {
    console.error('Test suite execution error:', err);
    process.exit(1);
});
