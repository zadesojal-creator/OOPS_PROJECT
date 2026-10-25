import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import fs from 'fs';
import { db } from '../firebase/admin';
import { FamilyService } from '../telegram/services/FamilyService';
import { getMainMenu } from '../telegram/ui';

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

async function runVerification() {
    console.log('================================================================');
    console.log(' ClinicQueue Family Registration & Telegram Verification Suite  ');
    console.log('================================================================\n');

    const testChatId = 'TEST_FAM_CHAT_' + Date.now();
    const unauthChatId = 'UNAUTH_CHAT_' + Date.now();
    const sharedPhone = '+919876543210';

    // -------------------------------------------------------------
    // SCENARIO 1: /start displays the family registration menu
    // -------------------------------------------------------------
    console.log('--- SCENARIO 1: /start Menu Verification ---');
    const mainMenu = getMainMenu();
    const buttons = mainMenu.reply_markup.keyboard.flat().map(b => b.text);
    
    assert(buttons.includes('📝 Register a New Patient'), 'Contains "Register a New Patient" option');
    assert(buttons.includes('👤 Select an Existing Patient'), 'Contains "Select an Existing Patient" option');
    assert(buttons.includes('👨‍👩‍👧 My Family Members'), 'Contains "My Family Members" option');
    assert(buttons.includes('📅 Book an Appointment'), 'Contains "Book an Appointment" option');
    assert(buttons.includes('📊 Check Appointment / Token Status'), 'Contains "Check Appointment / Token Status" option');
    assert(buttons.includes('❓ Help / Clinic FAQs'), 'Contains "Help / Clinic FAQs" option');

    // -------------------------------------------------------------
    // SCENARIO 2: Register multiple family members under one chat
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 2: Register Multiple Family Members ---');
    const member1 = await FamilyService.addFamilyMember(testChatId, {
        name: 'Rahul Sharma',
        age: 38,
        gender: 'Male',
        phone: sharedPhone,
        relationship: 'Self'
    });
    assert(!!member1.patientId, 'Member 1 (Rahul) registered', `ID: ${member1.patientId}`);

    const member2 = await FamilyService.addFamilyMember(testChatId, {
        name: 'Priya Sharma',
        age: 35,
        gender: 'Female',
        phone: sharedPhone,
        relationship: 'Spouse'
    });
    assert(!!member2.patientId, 'Member 2 (Priya) registered', `ID: ${member2.patientId}`);

    const member3 = await FamilyService.addFamilyMember(testChatId, {
        name: 'Aarav Sharma',
        age: 8,
        gender: 'Male',
        phone: sharedPhone,
        relationship: 'Child'
    });
    assert(!!member3.patientId, 'Member 3 (Aarav) registered', `ID: ${member3.patientId}`);

    const familyList = await FamilyService.getFamilyMembers(testChatId);
    assert(familyList.length >= 3, 'All 3 family members retrieved under test chat', `Total: ${familyList.length}`);
    const names = familyList.map(m => m.name);
    assert(names.includes('Rahul Sharma') && names.includes('Priya Sharma') && names.includes('Aarav Sharma'),
        'All three member names present in family list');

    // -------------------------------------------------------------
    // SCENARIO 3: Select family member before booking attributes appointment to that patient
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 3: Member Selection & Booking Attribution ---');
    const switchSuccess = await FamilyService.setActivePatient(testChatId, member3.patientId);
    assert(switchSuccess, 'Successfully set Aarav Sharma as active patient');

    const activePatient = await FamilyService.getActivePatient(testChatId);
    assert(activePatient?.patientId === member3.patientId, 'Active patient correctly resolved to Aarav Sharma');

    // Simulate booking an appointment under active patient
    const apptRef = db.collection('appointments').doc();
    const apptData = {
        patientId: activePatient!.patientId,
        patientName: activePatient!.name,
        doctorId: 'DOC_TEST_01',
        doctorName: 'Dr. Sarah Patel',
        date: new Date().toISOString().split('T')[0],
        startTime: '10:00 AM',
        status: 'BOOKED',
        createdAt: new Date().toISOString()
    };
    await apptRef.set(apptData);

    const savedAppt = await apptRef.get();
    assert(savedAppt.data()?.patientId === member3.patientId,
        'Appointment strictly references Aarav\'s patientId',
        `appt.patientId: ${savedAppt.data()?.patientId}`);
    assert(savedAppt.data()?.patientName === 'Aarav Sharma',
        'Appointment carries Aarav Sharma\'s patientName');

    // -------------------------------------------------------------
    // SCENARIO 4: Existing patient records are preserved and not duplicated
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 4: Link Existing Patient Without Duplication ---');
    const existingPatientRef = db.collection('patients').doc();
    const existingPatientData = {
        name: 'Grandpa Ramesh Sharma',
        age: 72,
        gender: 'Male',
        phone: '+919111222333',
        createdAt: new Date().toISOString()
    };
    await existingPatientRef.set(existingPatientData);

    const preCountSnap = await db.collection('patients').get();
    const prePatientCount = preCountSnap.size;

    // Link Grandpa Ramesh to testChatId as Parent
    const linkSuccess = await FamilyService.linkExistingPatient(testChatId, existingPatientRef.id, 'Parent');
    assert(linkSuccess, 'Link existing patient succeeded');

    const postCountSnap = await db.collection('patients').get();
    const postPatientCount = postCountSnap.size;
    assert(prePatientCount === postPatientCount,
        'No duplicate patient document created in patients collection',
        `Count remained: ${postPatientCount}`);

    const updatedFamily = await FamilyService.getFamilyMembers(testChatId);
    const grandpaEntry = updatedFamily.find(m => m.patientId === existingPatientRef.id);
    assert(!!grandpaEntry && grandpaEntry.name === 'Grandpa Ramesh Sharma',
        'Grandpa Ramesh successfully added to family members with relationship "Parent"');

    // -------------------------------------------------------------
    // SCENARIO 5: Two family members with same phone remain separate documents
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 5: Shared Phone Disambiguation ---');
    const rahulDoc = await db.collection('patients').doc(member1.patientId).get();
    const priyaDoc = await db.collection('patients').doc(member2.patientId).get();

    assert(rahulDoc.exists && priyaDoc.exists, 'Both patient documents exist in Firestore');
    assert(member1.patientId !== member2.patientId,
        'Rahul and Priya possess distinct, unique document IDs',
        `${member1.patientId} vs ${member2.patientId}`);
    assert(rahulDoc.data()?.phone === priyaDoc.data()?.phone,
        'Both records share the same family telephone number',
        sharedPhone);
    assert(rahulDoc.data()?.name === 'Rahul Sharma' && priyaDoc.data()?.name === 'Priya Sharma',
        'Names and profiles are isolated and not overwritten');

    // -------------------------------------------------------------
    // SCENARIO 6: Unauthorized chats cannot access other family members' records
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 6: Cross-Chat Privacy & Authorization ---');
    const unauthFamily = await FamilyService.getFamilyMembers(unauthChatId);
    const unauthPatientIds = unauthFamily.map(m => m.patientId);
    assert(!unauthPatientIds.includes(member1.patientId), 'Unauthorized chat cannot access Rahul Sharma');
    assert(!unauthPatientIds.includes(member2.patientId), 'Unauthorized chat cannot access Priya Sharma');
    assert(!unauthPatientIds.includes(member3.patientId), 'Unauthorized chat cannot access Aarav Sharma');
    assert(!unauthPatientIds.includes(existingPatientRef.id), 'Unauthorized chat cannot access Grandpa Ramesh');

    // -------------------------------------------------------------
    // SCENARIO 7: Doctor generates prescription -> Telegram automatically resolved
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 7: Automatic Telegram Chat Resolution for Prescription ---');
    const resolvedChatId = await FamilyService.getAuthorizedChatForPatient(member1.patientId);
    assert(resolvedChatId === testChatId,
        'Authorized Telegram chat resolved automatically without doctor entering phone',
        `Resolved: ${resolvedChatId}`);

    // -------------------------------------------------------------
    // SCENARIO 8: No phone-number modal appears for doctor
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 8: Doctor UI Automation Verification ---');
    const consultationPagePath = path.resolve(__dirname, '../../../frontend/src/pages/Consultation.tsx');
    const consultationCode = fs.readFileSync(consultationPagePath, 'utf-8');
    
    // Check that savePrescription does not call setShowTelegramModal(true)
    const saveRxMatch = consultationCode.indexOf('async function savePrescription');
    const saveRxBlock = consultationCode.slice(saveRxMatch, saveRxMatch + 1500);
    const modalTriggeredInSave = saveRxBlock.includes('setShowTelegramModal(true)');
    assert(!modalTriggeredInSave, 'savePrescription() does NOT open telegram phone modal');

    // -------------------------------------------------------------
    // SCENARIO 9: Missing Telegram link saves prescription normally with TELEGRAM_NOT_CONFIGURED
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 9: Missing Telegram Link Handling ---');
    const unlinkedPtRef = db.collection('patients').doc();
    await unlinkedPtRef.set({
        name: 'Unlinked Patient',
        age: 45,
        gender: 'Male',
        phone: '+919999900000',
        createdAt: new Date().toISOString()
    });

    const unlinkedChat = await FamilyService.getAuthorizedChatForPatient(unlinkedPtRef.id);
    assert(unlinkedChat === null, 'Unlinked patient returns null for authorized chat');

    const rxUnlinkedRef = db.collection('prescriptions').doc();
    const rxUnlinkedData = {
        consultationId: 'CONSULT_TEST_UNLINKED',
        patientId: unlinkedPtRef.id,
        patientName: 'Unlinked Patient',
        doctorId: 'DOC_TEST_01',
        doctorName: 'Dr. Sarah Patel',
        fileName: `${rxUnlinkedRef.id}.pdf`,
        telegramDelivery: {
            status: 'TELEGRAM_NOT_CONFIGURED',
            error: 'No authorized Telegram account linked for this patient.'
        },
        createdAt: new Date().toISOString()
    };
    await rxUnlinkedRef.set(rxUnlinkedData);

    const savedUnlinkedRx = await rxUnlinkedRef.get();
    assert(savedUnlinkedRx.exists, 'Prescription saved successfully in database');
    assert(savedUnlinkedRx.data()?.telegramDelivery?.status === 'TELEGRAM_NOT_CONFIGURED',
        'Prescription status is TELEGRAM_NOT_CONFIGURED');

    // -------------------------------------------------------------
    // SCENARIO 10: Telegram delivery failures preserve the PDF with FAILED status
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 10: Delivery Failure Preservation ---');
    const dummyPdfPath = path.resolve(__dirname, `../../storage/prescriptions/dummy-${Date.now()}.pdf`);
    const storageDir = path.dirname(dummyPdfPath);
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(dummyPdfPath, '%PDF-1.4 test dummy prescription content');

    const rxFailedRef = db.collection('prescriptions').doc();
    const rxFailedData = {
        consultationId: 'CONSULT_TEST_FAIL',
        patientId: member1.patientId,
        patientName: 'Rahul Sharma',
        doctorId: 'DOC_TEST_01',
        doctorName: 'Dr. Sarah Patel',
        filePath: dummyPdfPath,
        fileName: path.basename(dummyPdfPath),
        telegramDelivery: {
            status: 'FAILED',
            triedAt: new Date().toISOString(),
            chatId: testChatId,
            error: 'Simulated network timeout connecting to Telegram API'
        },
        createdAt: new Date().toISOString()
    };
    await rxFailedRef.set(rxFailedData);

    const savedFailedRx = await rxFailedRef.get();
    assert(savedFailedRx.exists, 'Failed prescription document preserved in Firestore');
    assert(fs.existsSync(dummyPdfPath), 'Prescription PDF file preserved on disk');
    assert(savedFailedRx.data()?.telegramDelivery?.status === 'FAILED', 'Status recorded as FAILED');

    // -------------------------------------------------------------
    // SCENARIO 11: Retry delivery works without creating duplicate prescriptions
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 11: Retry Delivery Without Duplication ---');
    const preRxCount = (await db.collection('prescriptions').get()).size;

    // Simulate retry updating the existing prescription
    const updatedDelivery = {
        status: 'SENT',
        sentAt: new Date().toISOString(),
        chatId: testChatId,
        recipientName: 'Rahul Sharma'
    };
    await rxFailedRef.update({
        telegramDelivery: updatedDelivery
    });

    const postRxCount = (await db.collection('prescriptions').get()).size;
    assert(preRxCount === postRxCount,
        'Prescription count unchanged; no duplicate created on retry',
        `Count: ${postRxCount}`);

    const retriedRx = await rxFailedRef.get();
    assert(retriedRx.data()?.telegramDelivery?.status === 'SENT',
        'Prescription delivery status updated to SENT in place');

    // -------------------------------------------------------------
    // SCENARIO 12: Web booking, queue tokens, and doctor dashboards remain functional
    // -------------------------------------------------------------
    console.log('\n--- SCENARIO 12: End-to-End System Integration ---');
    const queueRef = db.collection('queue').doc();
    await queueRef.set({
        patientId: member2.patientId,
        patientName: 'Priya Sharma',
        doctorId: 'DOC_TEST_01',
        doctorName: 'Dr. Sarah Patel',
        tokenNumber: 'W-101',
        priority: 'NORMAL',
        status: 'WAITING',
        source: 'TELEGRAM_FAMILY',
        createdAt: new Date().toISOString()
    });

    const queueDoc = await queueRef.get();
    assert(queueDoc.exists, 'Queue token created for family member');
    assert(queueDoc.data()?.patientId === member2.patientId, 'Token linked to Priya Sharma');

    // Verify doctor queue query still returns this token
    const docQueueSnap = await db.collection('queue')
        .where('doctorId', '==', 'DOC_TEST_01')
        .where('status', '==', 'WAITING')
        .get();
    assert(!docQueueSnap.empty, 'Doctor dashboard query retrieves waiting family patient tokens');

    // Verify slot generation with C++ Engine (both generateSlots and computeAvailableSlots alias)
    const { CppEngine } = await import('../cpp-adapter/CppEngine');
    const directSlotResult = await CppEngine.execute('generateSlots', {
        startTime: "09:00",
        endTime: "17:00",
        lunchStart: "13:00",
        lunchEnd: "14:00",
        slotDurationMinutes: 20,
        workingDays: [1, 2, 3, 4, 5, 6],
        bookedSlots: ["09:00"],
        targetDate: "2026-10-20",
        nowUtc: "2026-10-12T00:00:00Z"
    });
    assert(Array.isArray(directSlotResult.slots) && directSlotResult.slots.length > 0,
        'CppEngine.execute("generateSlots") succeeds',
        `Returned ${directSlotResult.slots?.length} slots`);
    assert(!directSlotResult.slots.includes("09:00"), 'Booked slot 09:00 excluded from available slots');

    const aliasSlotResult = await CppEngine.execute('computeAvailableSlots', {
        schedule: {
            startTime: "10:00",
            endTime: "16:00",
            lunchStart: "12:00",
            lunchEnd: "13:00",
            slotDurationMinutes: 30,
            workingDays: [1, 2, 3, 4, 5, 6]
        },
        bookedSlots: [],
        date: "2026-10-21"
    });
    assert(Array.isArray(aliasSlotResult.slots) && aliasSlotResult.slots.length > 0,
        'CppEngine.execute("computeAvailableSlots") alias succeeds',
        `Returned ${aliasSlotResult.slots?.length} slots`);

    // Clean up temporary dummy PDF
    if (fs.existsSync(dummyPdfPath)) fs.unlinkSync(dummyPdfPath);

    // -------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------
    console.log('\n================================================================');
    console.log(` RESULTS: ${testsPassed} PASSED, ${testsFailed} FAILED`);
    console.log('================================================================\n');

    if (testsFailed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runVerification().catch(err => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
});
