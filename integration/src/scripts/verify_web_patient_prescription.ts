import axios from 'axios';
import { db, auth } from '../firebase/admin';
import { FamilyService } from '../telegram/services/FamilyService';

const API_BASE = 'http://localhost:3000/api';
const FIREBASE_API_KEY = 'AIzaSyD0OvF8HGxONxdDpwLLIu83SyCABXhJK-U';

async function getIdTokenByPassword(email: string, pass: string): Promise<string> {
    const res = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
        { email, password: pass, returnSecureToken: true }
    );
    return res.data.idToken;
}

interface TestResult {
    name: string;
    passed: boolean;
    details: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details: string) {
    results.push({ name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark}: ${name} - ${details}`);
}

async function runTests() {
    console.log('====================================================');
    console.log('WEB PATIENT TELEGRAM PRESCRIPTION VERIFICATION SUITE');
    console.log('====================================================\n');

    let doctorToken = '';
    let receptionistToken = '';
    const doctorUid = 'JLrccV1bVSWx77drKgaJsTwC6K93';

    try {
        doctorToken = await getIdTokenByPassword('doctor@gmail.com', 'Doctor@123');
        receptionistToken = await getIdTokenByPassword('receptionist@gmail.com', 'Receptionist@123');
        record('Authentication', true, 'Obtained tokens for Doctor and Receptionist');
    } catch (e: any) {
        record('Authentication', false, e.message);
        return;
    }

    const knownPhone = '9359731276';
    const knownChatId = '7967702570';

    // Ensure knownChatId exists in telegramAccounts for test reliability
    await db.collection('telegramAccounts').doc(knownChatId).set({
        chatId: knownChatId,
        username: 'test_user',
        updatedAt: new Date().toISOString()
    }, { merge: true });

    // Step 1: Register patient from website via POST /api/patients with phone
    let patientId = '';
    let walkInTokenId = '';
    try {
        const regRes = await axios.post(`${API_BASE}/patients`, {
            name: 'Web Intake Patient ' + Date.now(),
            phone: '+91' + knownPhone,
            age: 34,
            gender: 'Male',
            visitType: 'WALK_IN',
            doctorId: doctorUid,
            priority: 'NORMAL'
        }, {
            headers: { Authorization: `Bearer ${receptionistToken}` }
        });

        patientId = regRes.data.id;
        walkInTokenId = regRes.data.walkInToken?.id;
        record('Website Patient Registration', true, `Registered patient ${patientId} with phone +91${knownPhone}`);
        record('Auto-Link on Registration', regRes.data.telegramLinked === true && regRes.data.telegramChatId === knownChatId,
            `telegramLinked=${regRes.data.telegramLinked}, telegramChatId=${regRes.data.telegramChatId}`);
    } catch (e: any) {
        record('Website Patient Registration', false, e.response?.data?.message || e.message);
        return;
    }

    // Step 2: Verify FamilyService.getAuthorizedChatForPatient resolves by phone
    try {
        const resolvedChat = await FamilyService.getAuthorizedChatForPatient(patientId);
        record('FamilyService Phone Resolution', resolvedChat === knownChatId, `Resolved chatId: ${resolvedChat} (expected ${knownChatId})`);
    } catch (e: any) {
        record('FamilyService Phone Resolution', false, e.message);
    }

    // Step 3: Record Consultation
    let consultationId = '';
    try {
        // Set queue status to CALLED
        if (walkInTokenId) {
            await db.collection('queue').doc(walkInTokenId).update({ status: 'CALLED' });
        }
        const consultRes = await axios.post(`${API_BASE}/consultations`, {
            queueId: walkInTokenId || 'dummy-queue',
            patientId,
            diagnosis: 'Acute Viral Pharyngitis',
            notes: 'Throat discomfort, fever'
        }, {
            headers: { Authorization: `Bearer ${doctorToken}` }
        });
        consultationId = consultRes.data.id;
        record('Record Consultation', true, `Consultation created: ${consultationId}`);
    } catch (e: any) {
        record('Record Consultation', false, e.response?.data?.message || e.message);
        return;
    }

    // Step 4: Generate Prescription (should auto-deliver to knownChatId)
    let prescriptionId = '';
    try {
        const rxRes = await axios.post(`${API_BASE}/prescriptions`, {
            consultationId,
            medications: [
                { name: 'Paracetamol', dosage: '650mg', frequency: '1-0-1', duration: '3 days' },
                { name: 'Azithromycin', dosage: '500mg', frequency: '1-0-0', duration: '3 days' }
            ],
            instructions: 'Take after meals with plenty of water',
            followUpDate: '3 days'
        }, {
            headers: { Authorization: `Bearer ${doctorToken}` }
        });

        prescriptionId = rxRes.data.id;
        const delivery = rxRes.data.telegramDelivery;
        record('Prescription Generation', true, `Prescription PDF generated: ${prescriptionId}`);
        record('Prescription Chat Resolution', delivery?.chatId === knownChatId || delivery?.status === 'SENT',
            `Delivery status: ${delivery?.status}, target chatId: ${delivery?.chatId || delivery?.recipientPhone}`);
    } catch (e: any) {
        record('Prescription Generation', false, e.response?.data?.message || e.message);
        return;
    }

    // Step 5: Verify Recipient Endpoint
    try {
        const verifyRes = await axios.post(`${API_BASE}/prescriptions/${prescriptionId}/verify-recipient`, {
            phone: knownPhone
        }, {
            headers: { Authorization: `Bearer ${doctorToken}` }
        });
        record('Verify Recipient Phone Endpoint', verifyRes.data.matched === true && verifyRes.data.isLinked === true,
            `matched=${verifyRes.data.matched}, isLinked=${verifyRes.data.isLinked}, chatId=${verifyRes.data.chatId}`);
    } catch (e: any) {
        record('Verify Recipient Phone Endpoint', false, e.response?.data?.message || e.message);
    }

    // Step 6: Test Retry Telegram Delivery (Must NOT return 400 Bad Request)
    try {
        const retryRes = await axios.post(`${API_BASE}/prescriptions/${prescriptionId}/retry-telegram`, {}, {
            headers: { Authorization: `Bearer ${doctorToken}` }
        });
        record('Retry Telegram Delivery', retryRes.status === 200, `Returned HTTP ${retryRes.status}, delivery=${retryRes.data.telegramDelivery?.status}`);
    } catch (e: any) {
        // If it failed due to telegram network error, it would be 502, NOT 400
        const status = e.response?.status;
        record('Retry Telegram Delivery', status !== 400, `Response status ${status}: ${e.response?.data?.message || e.message}`);
    }

    // Step 7: Test Web Registration with explicit Telegram Chat ID
    try {
        const directChatId = '8180301884';
        const regWithChat = await axios.post(`${API_BASE}/patients`, {
            name: 'Direct Chat Patient ' + Date.now(),
            phone: '+919988776655',
            telegramChatId: directChatId,
            age: 28,
            gender: 'Female',
            visitType: 'NONE'
        }, {
            headers: { Authorization: `Bearer ${receptionistToken}` }
        });
        const linkedChat = regWithChat.data.telegramChatId;
        record('Web Registration with Direct Chat ID', linkedChat === directChatId && regWithChat.data.telegramLinked === true,
            `Linked to Telegram Chat ID: ${linkedChat}`);
    } catch (e: any) {
        record('Web Registration with Direct Chat ID', false, e.response?.data?.message || e.message);
    }

    console.log('\n====================================================');
    console.log(`TOTAL: ${results.length} | PASSED: ${results.filter(r => r.passed).length} | FAILED: ${results.filter(r => !r.passed).length}`);
    console.log('====================================================');
}

runTests().then(() => process.exit(0)).catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
