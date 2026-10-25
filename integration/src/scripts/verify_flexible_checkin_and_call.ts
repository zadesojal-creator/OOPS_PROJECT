import axios from 'axios';
import https from 'https';
import { db } from '../firebase/admin';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const API_BASE = 'http://127.0.0.1:3000/api';
const FIREBASE_API_KEY = 'AIzaSyD0OvF8HGxONxdDpwLLIu83SyCABXhJK-U';

async function getIdToken(email: string, password: string): Promise<string> {
    const res = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
        email,
        password,
        returnSecureToken: true
    }, { httpsAgent });
    return res.data.idToken;
}

async function runTest() {
    console.log('====================================================');
    console.log('🧪 TESTING FLEXIBLE CHECK-IN & DOCTOR CALL WORKFLOW');
    console.log('====================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(cond: boolean, name: string, detail?: string) {
        if (cond) {
            console.log(`  ✅ PASS: ${name}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${name} ${detail ? `(${detail})` : ''}`);
            failed++;
        }
    }

    console.log('1. Authenticating test users...');
    const doctorToken = await getIdToken('doctor@gmail.com', 'Doctor@123');
    const receptionistToken = await getIdToken('receptionist@gmail.com', 'Receptionist@123');

    // Get doctor record for doctor@gmail.com
    const doctorUserSnap = await db.collection('users').where('email', '==', 'doctor@gmail.com').limit(1).get();
    if (doctorUserSnap.empty) throw new Error('Doctor user record not found');
    const doctor = { id: doctorUserSnap.docs[0].id, ...doctorUserSnap.docs[0].data() } as any;

    const today = new Date().toISOString().split('T')[0];
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Find or create test patient
    let patientId = 'test_patient_flexible_checkin';
    await db.collection('patients').doc(patientId).set({
        name: 'Arrived Patient Test',
        phone: '+919876543210',
        age: 45,
        gender: 'Male',
        createdAt: new Date().toISOString()
    }, { merge: true });

    const pastAptId = `test_apt_past_${Date.now()}`;
    const futureAptId = `test_apt_future_${Date.now()}`;
    let pastTokenId = '';
    let futureTokenId = '';
    let consultationId = '';
    let rxId = '';

    try {
        // ----------------------------------------------------
        // TEST 1: Check-in for an appointment from 3 days ago
        // ----------------------------------------------------
        console.log(`\n--- TEST 1: Check-in appointment from 3 days ago (${threeDaysAgo}) ---`);
        await db.collection('appointments').doc(pastAptId).set({
            patientId,
            patientName: 'Arrived Patient Test',
            doctorId: doctor.id,
            doctorName: doctor.name,
            doctorSpecialization: doctor.specialization || 'General Physician',
            date: threeDaysAgo,
            startTime: '10:00',
            endTime: '10:20',
            status: 'BOOKED',
            checkInStatus: 'NOT_ARRIVED',
            createdAt: new Date().toISOString()
        });

        const checkinRes = await axios.post(`${API_BASE}/appointments/${pastAptId}/checkin`, {}, {
            headers: { Authorization: `Bearer ${receptionistToken}` },
            validateStatus: () => true
        });

        assert(checkinRes.status === 200, 'Receptionist successfully checks in appointment from 3 days ago', `Status: ${checkinRes.status}, Msg: ${checkinRes.data?.message}`);
        assert(checkinRes.data?.status === 'WAITING', 'Live queue token is created with WAITING status');
        assert(checkinRes.data?.tokenNumber?.startsWith('T-'), 'Valid token number assigned for today');
        pastTokenId = checkinRes.data?.queueId;

        // Verify in Firestore
        const aptAfterPast = await db.collection('appointments').doc(pastAptId).get();
        assert(aptAfterPast.data()?.status === 'CHECKED_IN', 'Appointment status transitioned to CHECKED_IN');
        assert(aptAfterPast.data()?.checkInStatus === 'CHECKED_IN', 'Appointment checkInStatus transitioned to CHECKED_IN');

        const queueDocPast = await db.collection('queue').doc(pastTokenId).get();
        assert(queueDocPast.exists, 'Live queue token document exists in Firestore');
        assert(queueDocPast.data()?.doctorId === doctor.id, 'Live queue token assigned to consulting doctor');
        assert(queueDocPast.data()?.originalAppointmentDate === threeDaysAgo, 'Original appointment date recorded');

        // ----------------------------------------------------
        // TEST 2: Check-in for an upcoming appointment next week
        // ----------------------------------------------------
        console.log(`\n--- TEST 2: Check-in upcoming appointment (${nextWeek}) ---`);
        await db.collection('appointments').doc(futureAptId).set({
            patientId,
            patientName: 'Arrived Patient Test',
            doctorId: doctor.id,
            doctorName: doctor.name,
            doctorSpecialization: doctor.specialization || 'General Physician',
            date: nextWeek,
            startTime: '14:30',
            endTime: '14:50',
            status: 'BOOKED',
            checkInStatus: 'NOT_ARRIVED',
            createdAt: new Date().toISOString()
        });

        const futureCheckinRes = await axios.post(`${API_BASE}/appointments/${futureAptId}/checkin`, {}, {
            headers: { Authorization: `Bearer ${receptionistToken}` },
            validateStatus: () => true
        });

        assert(futureCheckinRes.status === 200, 'Receptionist successfully checks in early arrival for upcoming appointment', `Status: ${futureCheckinRes.status}, Msg: ${futureCheckinRes.data?.message}`);
        assert(futureCheckinRes.data?.status === 'WAITING', 'Live queue token created for early arrival');
        futureTokenId = futureCheckinRes.data?.queueId;

        // ----------------------------------------------------
        // TEST 3: Doctor Can Call ANY Checked-In Patient Directly
        // ----------------------------------------------------
        console.log(`\n--- TEST 3: Doctor Calling Any Checked-in Patient Directly ---`);
        // Calling pastTokenId directly (the patient who arrived today with 3-day-old appointment)
        const callRes = await axios.post(`${API_BASE}/queue/${pastTokenId}/call`, {}, {
            headers: { Authorization: `Bearer ${doctorToken}` },
            validateStatus: () => true
        });

        assert(callRes.status === 200, 'Doctor successfully called the checked-in 3-day-old appointment patient directly', `Status: ${callRes.status}, Msg: ${callRes.data?.message}`);
        assert(callRes.data?.status === 'CALLED', 'Token status updated to CALLED');

        const calledTokenDoc = await db.collection('queue').doc(pastTokenId).get();
        assert(calledTokenDoc.data()?.status === 'CALLED', 'Firestore token status is CALLED');

        // ----------------------------------------------------
        // TEST 4: Doctor Records Clinical Diagnosis
        // ----------------------------------------------------
        console.log(`\n--- TEST 4: Doctor Diagnoses Patient ---`);
        const consultRes = await axios.post(`${API_BASE}/consultations`, {
            queueId: pastTokenId,
            diagnosis: 'Acute Viral Pharyngitis with Upper Respiratory Infection',
            notes: 'Patient arrived 3 days after original booking. Symptoms include mild fever and sore throat.',
            patientId
        }, {
            headers: { Authorization: `Bearer ${doctorToken}` },
            validateStatus: () => true
        });

        assert(consultRes.status === 200 || consultRes.status === 201, 'Consultation recorded successfully', `Status: ${consultRes.status}`);
        consultationId = consultRes.data?.id;
        assert(!!consultationId, 'Consultation ID returned');
        assert(consultRes.data?.diagnosis?.includes('Viral Pharyngitis'), 'Diagnosis content saved correctly');

        // ----------------------------------------------------
        // TEST 5: Doctor Creates Prescription & Generates PDF
        // ----------------------------------------------------
        console.log(`\n--- TEST 5: Doctor Creates Prescription & Generates PDF ---`);
        const rxRes = await axios.post(`${API_BASE}/prescriptions`, {
            consultationId,
            medications: [
                { name: 'Amoxicillin', dosage: '500mg', frequency: '1-0-1', duration: '5 days', instructions: 'After meals' },
                { name: 'Paracetamol', dosage: '650mg', frequency: 'As needed', duration: '3 days', instructions: 'For fever' }
            ],
            instructions: 'Drink warm water and get plenty of rest.',
            followUpDate: 'In 5 days if fever persists'
        }, {
            headers: { Authorization: `Bearer ${doctorToken}` },
            validateStatus: () => true
        });

        assert(rxRes.status === 200 || rxRes.status === 201, 'Prescription saved and PDF generated', `Status: ${rxRes.status}`);
        rxId = rxRes.data?.id;
        assert(!!rxId, 'Prescription ID generated');
        assert(!!rxRes.data?.downloadUrl, 'PDF download URL available');

        // ----------------------------------------------------
        // TEST 6: Doctor Calls Next Patient in Line
        // ----------------------------------------------------
        console.log(`\n--- TEST 6: Doctor Calls Next Patient in Line (/call-next) ---`);
        const callNextRes = await axios.post(`${API_BASE}/queue/call-next`, {}, {
            headers: { Authorization: `Bearer ${doctorToken}` },
            validateStatus: () => true
        });

        assert(callNextRes.status === 200, 'Doctor /call-next succeeded and returned next patient', `Status: ${callNextRes.status}, Msg: ${callNextRes.data?.message}`);
        assert(callNextRes.data?.status === 'CALLED', 'Next token is marked CALLED');
        assert(!!callNextRes.data?.id, 'Doctor /call-next successfully picked and called next patient');

    } finally {
        // Cleanup test documents
        console.log('\n--- CLEANUP: Removing test documents ---');
        await db.collection('appointments').doc(pastAptId).delete();
        await db.collection('appointments').doc(futureAptId).delete();
        if (pastTokenId) await db.collection('queue').doc(pastTokenId).delete();
        if (futureTokenId) await db.collection('queue').doc(futureTokenId).delete();
        if (rxId) await db.collection('prescriptions').doc(rxId).delete();
        if (consultationId) await db.collection('consultations').doc(consultationId).delete();
        await db.collection('patients').doc(patientId).delete();
        console.log('Cleaned up test appointments, queue tokens, consultation and prescription.');
    }

    console.log('\n====================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');

    process.exit(failed > 0 ? 1 : 0);
}

runTest().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
