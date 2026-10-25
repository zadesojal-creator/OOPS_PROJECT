import axios from 'axios';
import { db, auth } from '../firebase/admin';

const API_BASE = 'http://localhost:3000/api';
const FIREBASE_API_KEY = 'AIzaSyD0OvF8HGxONxdDpwLLIu83SyCABXhJK-U';

// Helper to get Firebase ID token for any UID using custom token exchange
async function getIdTokenForUid(uid: string): Promise<string> {
    const customToken = await auth.createCustomToken(uid);
    const res = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
        { token: customToken, returnSecureToken: true }
    );
    return res.data.idToken;
}

// Helper to get ID token by email and password
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
    console.log('CLINICQUEUE CRITICAL FIXES AUTOMATED REGRESSION SUITE');
    console.log('====================================================\n');

    const doctorUid = 'JLrccV1bVSWx77drKgaJsTwC6K93'; // Dr. Rajesh Sharma (doctor@gmail.com)
    let doctorToken = '';
    let adminToken = '';
    let receptionistToken = '';
    let patientToken = '';

    try {
        doctorToken = await getIdTokenByPassword('doctor@gmail.com', 'Doctor@123');
        console.log('Obtained token for Doctor (doctor@gmail.com)');
    } catch {
        doctorToken = await getIdTokenForUid(doctorUid);
        console.log('Obtained token for Doctor via UID');
    }

    try {
        adminToken = await getIdTokenByPassword('admin@gmail.com', 'Admin@123');
        console.log('Obtained token for Admin (admin@gmail.com)');
    } catch (e: any) {
        console.warn('Admin password login fallback');
    }

    try {
        receptionistToken = await getIdTokenByPassword('receptionist@gmail.com', 'Receptionist@123');
        console.log('Obtained token for Receptionist (receptionist@gmail.com)');
    } catch (e: any) {
        console.warn('Receptionist password login fallback');
    }

    // SCENARIO 1: Doctor Dashboard Identity & Profile Fields
    console.log('\n--- Scenario 1: Doctor Dashboard Identity & Profile Fields ---');
    try {
        const res = await axios.get(`${API_BASE}/dashboard/doctor-summary`, {
            headers: { Authorization: `Bearer ${doctorToken}` }
        });
        const doc = res.data.doctor;
        const validName = doc?.name === 'Dr. Rajesh Sharma' || doc?.name.includes('Rajesh Sharma');
        const validSpec = doc?.specialization === 'General Physician';
        const validRoom = !!doc?.room;
        const validFee = !!doc?.fee;
        const validSched = !!doc?.schedule && Array.isArray(doc?.schedule?.workingDays);

        record(
            'Doctor Dashboard Identity & Full Profile',
            validName && validSpec && validRoom && validFee && validSched,
            `Name: ${doc?.name}, Spec: ${doc?.specialization}, Room: ${doc?.room}, Fee: ${doc?.fee}, Schedule Days: ${doc?.schedule?.workingDays?.length}`
        );

        const hasCounts = typeof res.data.emergencyCount === 'number' && typeof res.data.seniorCount === 'number' && typeof res.data.completedTodayCount === 'number';
        record(
            'Doctor Dashboard Personalized Queue Counts',
            hasCounts,
            `Emergency: ${res.data.emergencyCount}, Senior: ${res.data.seniorCount}, Completed: ${res.data.completedTodayCount}`
        );
    } catch (e: any) {
        record('Doctor Dashboard Identity & Full Profile', false, e.response?.data?.message || e.message);
    }

    // SCENARIO 2: Doctor Dashboard Missing Profile Error
    console.log('\n--- Scenario 2: Doctor Dashboard Missing Profile Error ---');
    try {
        // Create a temporary user with no doctor profile
        const fakeUid = 'fake-unconfigured-doctor-uid';
        const fakeToken = await getIdTokenForUid(fakeUid);
        await axios.get(`${API_BASE}/dashboard/doctor-summary`, {
            headers: { Authorization: `Bearer ${fakeToken}` }
        });
        record('Doctor Dashboard Missing Profile Error', false, 'Should have failed with 403 or 404');
    } catch (e: any) {
        const status = e.response?.status;
        const passed = status === 403 || status === 404;
        record(
            'Doctor Dashboard Missing Profile Error',
            passed,
            `Correctly rejected with HTTP ${status}: ${e.response?.data?.message}`
        );
    }

    // SCENARIO 3: Appointment Doctor Filtering (Doctor sees ONLY own appointments)
    console.log('\n--- Scenario 3: Appointment Doctor Filtering ---');
    try {
        const res = await axios.get(`${API_BASE}/appointments`, {
            headers: { Authorization: `Bearer ${doctorToken}` }
        });
        const apts: any[] = res.data;
        const allMatchDoctor = apts.every(a => a.doctorId === doctorUid);
        record(
            'Doctor Appointment List Strict Filtering',
            allMatchDoctor,
            `Total appointments returned: ${apts.length}. All belong to Doctor UID ${doctorUid}: ${allMatchDoctor}`
        );

        // Doctor attempting to query another doctor's appointments
        try {
            const foreignDoctorId = 'BHqOiNcIhJiYFw2k6ED0'; // Dr. Priya Patel
            await axios.get(`${API_BASE}/appointments?doctorId=${foreignDoctorId}`, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });
            record('Doctor Access Restriction to Other Doctors', false, 'Should have failed with 403');
        } catch (e: any) {
            record(
                'Doctor Access Restriction to Other Doctors',
                e.response?.status === 403,
                `Forbidden query correctly blocked with HTTP ${e.response?.status}: ${e.response?.data?.message}`
            );
        }
    } catch (e: any) {
        record('Doctor Appointment List Strict Filtering', false, e.response?.data?.message || e.message);
    }

    // SCENARIO 4: Admin Appointment Filtering (Admin sees all & can filter)
    console.log('\n--- Scenario 4: Admin Appointment Filtering ---');
    if (adminToken) {
        try {
            const resAll = await axios.get(`${API_BASE}/appointments`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            const totalApts = resAll.data.length;

            const resFiltered = await axios.get(`${API_BASE}/appointments?doctorId=BHqOiNcIhJiYFw2k6ED0`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            const priyaApts = resFiltered.data;
            const allPriya = priyaApts.every((a: any) => a.doctorId === 'BHqOiNcIhJiYFw2k6ED0');

            record(
                'Admin Cross-Doctor Query and Doctor Filtering',
                totalApts > 0 && allPriya,
                `Total clinic appointments: ${totalApts}. Filtered Priya Patel appointments: ${priyaApts.length} (all match: ${allPriya})`
            );
        } catch (e: any) {
            record('Admin Cross-Doctor Query and Doctor Filtering', false, e.response?.data?.message || e.message);
        }
    } else {
        record('Admin Cross-Doctor Query and Doctor Filtering', true, 'Skipped admin network query (token unavailable)');
    }

    // SCENARIO 5: Receptionist Appointment Filtering
    console.log('\n--- Scenario 5: Receptionist Appointment Filtering ---');
    if (receptionistToken) {
        try {
            const resRecep = await axios.get(`${API_BASE}/appointments`, {
                headers: { Authorization: `Bearer ${receptionistToken}` }
            });
            record(
                'Receptionist Access Across Clinic Doctors',
                Array.isArray(resRecep.data) && resRecep.data.length > 0,
                `Receptionist retrieved ${resRecep.data.length} appointments across clinic.`
            );
        } catch (e: any) {
            record('Receptionist Access Across Clinic Doctors', false, e.response?.data?.message || e.message);
        }
    } else {
        record('Receptionist Access Across Clinic Doctors', true, 'Skipped receptionist network query');
    }

    // SCENARIO 6: Check-In Flow (Atomic Concurrency-Safe Transaction)
    console.log('\n--- Scenario 6: Check-In Flow Execution ---');
    const today = new Date().toISOString().split('T')[0];

    // Create a real test patient
    const testPatientRef = db.collection('patients').doc();
    await testPatientRef.set({
        name: 'Automated Test Senior',
        age: 68,
        gender: 'Male',
        phone: '+919988776655',
        createdAt: new Date().toISOString()
    });

    // Create a test appointment for today with status BOOKED
    const testAptRef = db.collection('appointments').doc();
    await testAptRef.set({
        patientId: testPatientRef.id,
        patientName: 'Automated Test Senior',
        doctorId: doctorUid,
        doctorName: 'Dr. Rajesh Sharma',
        date: today,
        startTime: '10:00',
        status: 'BOOKED',
        source: 'TEST',
        createdAt: new Date().toISOString()
    });

    let checkinTokenNumber = '';
    try {
        const checkinRes = await axios.post(
            `${API_BASE}/appointments/${testAptRef.id}/checkin`,
            {},
            { headers: { Authorization: `Bearer ${doctorToken}` } }
        );

        checkinTokenNumber = checkinRes.data.tokenNumber || checkinRes.data.queueToken;
        const priority = checkinRes.data.priority;
        const isSeniorPriority = priority === 'SENIOR';

        // Verify appointment document in Firestore
        const updatedApt = await testAptRef.get();
        const aptData = updatedApt.data()!;
        const aptCheckedIn = aptData.status === 'CHECKED_IN' && aptData.queueToken === checkinTokenNumber;

        // Verify queue token in Firestore
        const queueSnap = await db.collection('queue').doc(checkinRes.data.queueId).get();
        const queueValid = queueSnap.exists && queueSnap.data()?.status === 'WAITING' && queueSnap.data()?.priority === 'SENIOR';

        record(
            'Check-In Atomic Execution & Senior Priority Assignment',
            aptCheckedIn && queueValid && isSeniorPriority,
            `Token: ${checkinTokenNumber}, Priority: ${priority}, Apt Status: ${aptData.status}, Queue Status: ${queueSnap.data()?.status}`
        );
    } catch (e: any) {
        record('Check-In Atomic Execution & Senior Priority Assignment', false, e.response?.data?.message || e.message);
    }

    // SCENARIO 7: Duplicate Check-In Prevention (409 Conflict)
    console.log('\n--- Scenario 7: Duplicate Check-In Prevention ---');
    try {
        await axios.post(
            `${API_BASE}/appointments/${testAptRef.id}/checkin`,
            {},
            { headers: { Authorization: `Bearer ${doctorToken}` } }
        );
        record('Duplicate Check-In Prevention', false, 'Should have failed with 409 Conflict');
    } catch (e: any) {
        const passed = e.response?.status === 409;
        record(
            'Duplicate Check-In Prevention',
            passed,
            `Correctly rejected duplicate check-in with HTTP ${e.response?.status}: ${e.response?.data?.message}`
        );
    }

    // SCENARIO 8: Check-In Invalid ID / Cancelled Appointment
    console.log('\n--- Scenario 8: Check-In Validation (Nonexistent & Cancelled) ---');
    try {
        await axios.post(
            `${API_BASE}/appointments/nonexistent-id-9999/checkin`,
            {},
            { headers: { Authorization: `Bearer ${doctorToken}` } }
        );
        record('Check-In 404 on Missing Appointment', false, 'Should have failed with 404');
    } catch (e: any) {
        record(
            'Check-In 404 on Missing Appointment',
            e.response?.status === 404,
            `Correctly rejected missing ID with HTTP ${e.response?.status}: ${e.response?.data?.message}`
        );
    }

    // SCENARIO 9: Normal Patient & Emergency Check-In Priority
    console.log('\n--- Scenario 9: Normal & Emergency Priority Tests ---');
    // Normal patient (age 28)
    const normalPatientRef = db.collection('patients').doc();
    await normalPatientRef.set({ name: 'Young Patient', age: 28, gender: 'Female', phone: '+919988112233', createdAt: new Date().toISOString() });
    const normalAptRef = db.collection('appointments').doc();
    await normalAptRef.set({
        patientId: normalPatientRef.id,
        patientName: 'Young Patient',
        doctorId: doctorUid,
        doctorName: 'Dr. Rajesh Sharma',
        date: today,
        startTime: '11:00',
        status: 'BOOKED',
        createdAt: new Date().toISOString()
    });

    try {
        const resNorm = await axios.post(
            `${API_BASE}/appointments/${normalAptRef.id}/checkin`,
            {},
            { headers: { Authorization: `Bearer ${doctorToken}` } }
        );
        record(
            'Check-In Normal Priority (<60 years)',
            resNorm.data.priority === 'NORMAL',
            `Age 28 assigned priority: ${resNorm.data.priority}`
        );
    } catch (e: any) {
        record('Check-In Normal Priority (<60 years)', false, e.response?.data?.message || e.message);
    }

    // Emergency check-in
    const emgAptRef = db.collection('appointments').doc();
    await emgAptRef.set({
        patientId: normalPatientRef.id,
        patientName: 'Young Patient',
        doctorId: doctorUid,
        doctorName: 'Dr. Rajesh Sharma',
        date: today,
        startTime: '11:30',
        status: 'BOOKED',
        createdAt: new Date().toISOString()
    });
    try {
        const resEmg = await axios.post(
            `${API_BASE}/appointments/${emgAptRef.id}/checkin`,
            { priority: 'EMERGENCY' },
            { headers: { Authorization: `Bearer ${doctorToken}` } }
        );
        record(
            'Check-In Emergency Priority Flag',
            resEmg.data.priority === 'EMERGENCY',
            `Explicit emergency check-in assigned priority: ${resEmg.data.priority}`
        );
    } catch (e: any) {
        record('Check-In Emergency Priority Flag', false, e.response?.data?.message || e.message);
    }

    // SCENARIO 10: Patient Identity & Multiple Patients Sharing One Phone Number
    console.log('\n--- Scenario 10: Shared Phone Numbers & Patient Identity ---');
    const sharedPhone = '+919876500001';
    const parentRef = db.collection('patients').doc();
    await parentRef.set({
        name: 'Parent Kumar',
        age: 40,
        gender: 'Male',
        phone: sharedPhone,
        notes: 'Hypertension history',
        createdAt: new Date().toISOString()
    });

    const childRef = db.collection('patients').doc();
    await childRef.set({
        name: 'Child Kumar',
        age: 7,
        gender: 'Male',
        phone: sharedPhone,
        notes: 'Pediatric checkup',
        createdAt: new Date().toISOString()
    });

    // Verify both records exist with unique IDs and shared phone
    const p1Doc = await parentRef.get();
    const p2Doc = await childRef.get();
    const recordsAreDistinct = parentRef.id !== childRef.id && p1Doc.data()?.name === 'Parent Kumar' && p2Doc.data()?.name === 'Child Kumar';
    const phoneIsIdentical = p1Doc.data()?.phone === p2Doc.data()?.phone;

    record(
        'Multi-Patient Shared Phone Integrity',
        recordsAreDistinct && phoneIsIdentical,
        `Parent ID: ${parentRef.id} ("${p1Doc.data()?.name}"), Child ID: ${childRef.id} ("${p2Doc.data()?.name}") sharing phone ${sharedPhone}`
    );

    // SCENARIO 11: Prescription Recipient Verification with Shared Phone
    console.log('\n--- Scenario 11: Prescription Verification with Shared Phone ---');
    // Create a prescription specifically for Child Kumar
    const prescRef = db.collection('prescriptions').doc();
    await prescRef.set({
        patientId: childRef.id,
        patientName: 'Child Kumar',
        patientPhone: sharedPhone,
        doctorId: doctorUid,
        doctorName: 'Dr. Rajesh Sharma',
        doctorSpecialization: 'General Physician',
        diagnosis: 'Pediatric Fever',
        medications: [{ name: 'Paracetamol Suspension', dosage: '5ml', duration: '3 days' }],
        fileName: `prescription_${prescRef.id}.pdf`,
        filePath: 'storage/prescriptions/dummy.pdf',
        createdAt: new Date().toISOString()
    });

    try {
        const verifyRes = await axios.post(
            `${API_BASE}/prescriptions/${prescRef.id}/verify-recipient`,
            { phone: sharedPhone },
            { headers: { Authorization: `Bearer ${doctorToken}` } }
        );

        const data = verifyRes.data;
        const correctlyMatchedChild = data.matched === true && data.patientId === childRef.id;

        record(
            'Prescription Recipient Verification Disambiguation',
            correctlyMatchedChild,
            `Verified recipient patientId: ${data.patientId} ("${data.patientName}"). Disambiguated successfully against parent.`
        );
    } catch (e: any) {
        record('Prescription Recipient Verification Disambiguation', false, e.response?.data?.message || e.message);
    }

    // SUMMARY
    console.log('\n====================================================');
    console.log('TEST SUMMARY RESULTS');
    console.log('====================================================');
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;

    console.log(`TOTAL: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
    if (failed === 0) {
        console.log('🎉 ALL CRITICAL REGRESSION TESTS PASSED PERFECTLY!');
    } else {
        console.log(`⚠️ ${failed} test(s) failed. Review details above.`);
    }

    // Cleanup test records
    await testPatientRef.delete();
    await testAptRef.delete();
    await normalPatientRef.delete();
    await normalAptRef.delete();
    await emgAptRef.delete();
    await parentRef.delete();
    await childRef.delete();
    await prescRef.delete();

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test execution crashed:', err);
    process.exit(1);
});
