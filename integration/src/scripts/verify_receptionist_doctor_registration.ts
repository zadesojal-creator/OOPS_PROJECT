import axios from 'axios';
import https from 'https';
import { db, auth } from '../firebase/admin';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const API_BASE = 'http://localhost:3000/api';
const FIREBASE_API_KEY = 'AIzaSyD0OvF8HGxONxdDpwLLIu83SyCABXhJK-U';

async function getIdToken(email: string, password: string): Promise<string> {
    const res = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
        email,
        password,
        returnSecureToken: true
    }, { httpsAgent });
    return res.data.idToken;
}

async function run() {
    console.log('========================================================================');
    console.log(' RECEPTIONIST PATIENT REGISTRATION & DOCTOR SELECTION VERIFICATION');
    console.log('========================================================================\n');

    let passedCount = 0;
    let failedCount = 0;

    const assert = (condition: boolean, testName: string, detail?: string) => {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passedCount++;
        } else {
            console.error(`  ❌ FAIL: ${testName}${detail ? ` -> ${detail}` : ''}`);
            failedCount++;
        }
    };

    // 1. Authenticate Receptionist
    console.log('1. Authenticating receptionist user...');
    const recToken = await getIdToken('receptionist@gmail.com', 'Receptionist@123');
    assert(!!recToken, 'Receptionist successfully authenticated');

    // 2. Fetch Eligible Doctors & Specializations
    console.log('\n2. Testing Doctor & Specialization Loading...');
    const doctorsRes = await axios.get(`${API_BASE}/doctors`, {
        headers: { Authorization: `Bearer ${recToken}` }
    });
    const doctors = doctorsRes.data;
    assert(Array.isArray(doctors) && doctors.length > 0,
        'Eligible active doctors loaded from backend',
        `Count: ${doctors.length}`);

    const activeDoctor = doctors[0];
    const doctorId = activeDoctor.uid || activeDoctor.id;
    assert(!!doctorId && !!activeDoctor.name, 'Doctor contains valid id and name', `Dr. ${activeDoctor.name} (${activeDoctor.specialization})`);

    const specsRes = await axios.get(`${API_BASE}/specializations`, {
        headers: { Authorization: `Bearer ${recToken}` }
    });
    const specializations = specsRes.data;
    assert(Array.isArray(specializations) && specializations.length > 0,
        'Medical specializations loaded from backend',
        `Specializations: ${specializations.join(', ')}`);

    // Test specialization filtering query
    const filterSpecRes = await axios.get(`${API_BASE}/doctors?specialization=${encodeURIComponent(activeDoctor.specialization || 'General Physician')}`, {
        headers: { Authorization: `Bearer ${recToken}` }
    });
    assert(filterSpecRes.data.every((d: any) => (d.specialization || '').toLowerCase() === (activeDoctor.specialization || 'General Physician').toLowerCase()),
        'GET /doctors?specialization=... correctly filters eligible doctors');

    // 3. Workflow A: Register Patient with Consulting Doctor for Walk-In (Live Queue)
    console.log('\n3. Testing Workflow A: Patient Registration with Consulting Doctor as Walk-In...');
    const testPhone1 = `+919811${Math.floor(100000 + Math.random() * 900000)}`;
    let walkInPatient: any;

    try {
        const walkInRes = await axios.post(`${API_BASE}/patients`, {
            name: 'Robert Walkin Patient',
            phone: testPhone1,
            age: 62, // Senior citizen
            gender: 'Male',
            notes: 'Walk-in acute headache',
            visitType: 'WALK_IN',
            doctorId: doctorId,
            specialization: activeDoctor.specialization,
            priority: 'NORMAL' // Should be auto-elevated to SENIOR because age >= 60
        }, {
            headers: { Authorization: `Bearer ${recToken}` }
        });

        walkInPatient = walkInRes.data;
        assert(walkInRes.status === 201 && !!walkInPatient.id,
            'Walk-in patient registered with stable patientId',
            `ID: ${walkInPatient.id}`);
        assert(!!walkInPatient.walkInToken, 'Response includes walkInToken object');
        assert(walkInPatient.walkInToken?.doctorId === doctorId, 'Walk-in queue entry assigned to selected consulting doctor');
        assert(walkInPatient.walkInToken?.priority === 'SENIOR', 'Age 62 patient automatically assigned SENIOR priority');
        assert(!!walkInPatient.walkInToken?.tokenNumber,
            'Walk-in queue ticket assigned tokenNumber',
            `Token: ${walkInPatient.walkInToken?.tokenNumber}`);
        assert(typeof walkInPatient.walkInToken?.position === 'number',
            'Queue entry includes live queue position',
            `Position: #${walkInPatient.walkInToken?.position}`);
    } catch (e: any) {
        assert(false, 'Walk-in patient registration failed', e.response?.data?.message || e.message);
    }

    // 4. Workflow B: Register Patient with Consulting Doctor for Appointment Booking
    console.log('\n4. Testing Workflow B: Patient Registration with Consulting Doctor as Appointment...');
    const testPhone2 = `+919822${Math.floor(100000 + Math.random() * 900000)}`;
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const aptDateStr = futureDate.toISOString().split('T')[0];

    // Fetch available slots for this doctor and date
    const slotsRes = await axios.get(`${API_BASE}/appointments/available-slots`, {
        params: { doctorId: doctorId, date: aptDateStr },
        headers: { Authorization: `Bearer ${recToken}` }
    });
    const chosenSlot = slotsRes.data.slots?.[0] || '11:00';

    let aptPatient: any;
    try {
        const aptRes = await axios.post(`${API_BASE}/patients`, {
            name: 'Sarah Appointment Patient',
            phone: testPhone2,
            age: 28,
            gender: 'Female',
            notes: 'Routine consultation booking',
            visitType: 'APPOINTMENT',
            doctorId: doctorId,
            appointmentDate: aptDateStr,
            appointmentTime: chosenSlot
        }, {
            headers: { Authorization: `Bearer ${recToken}` }
        });

        aptPatient = aptRes.data;
        assert(aptRes.status === 201 && !!aptPatient.id,
            'Appointment patient registered with stable patientId',
            `ID: ${aptPatient.id}`);
        assert(!!aptPatient.appointment, 'Response includes appointment object');
        assert(aptPatient.appointment?.doctorId === doctorId, 'Appointment booked for selected consulting doctor');
        assert(aptPatient.appointment?.date === aptDateStr && aptPatient.appointment?.startTime === chosenSlot,
            'Appointment contains correct date and chosen time slot');
        assert(!!aptPatient.appointment?.endTime,
            'Appointment contains computed endTime interval',
            `${aptPatient.appointment?.startTime} - ${aptPatient.appointment?.endTime}`);
        assert(aptPatient.appointment?.status === 'BOOKED' && aptPatient.appointment?.checkInStatus === 'NOT_ARRIVED',
            'Appointment status is BOOKED and checkInStatus is NOT_ARRIVED');
    } catch (e: any) {
        assert(false, 'Appointment patient registration failed', e.response?.data?.message || e.message);
    }

    // 5. Patient & Doctor Relationship Flexibility (Multi-Doctor Care)
    console.log('\n5. Testing Multi-Doctor Relationship Preservation...');
    // Verify that the patient profile document in Firestore does NOT permanently bind to a single doctor
    const pDoc = await db.collection('patients').doc(walkInPatient.id).get();
    const pData = pDoc.data();
    assert(pData?.doctorId === undefined,
        'Patient profile document does not permanently assign a single doctorId (preserves multi-doctor care)');

    // 6. Returning Patient Workflow: Intake to Another Doctor
    console.log('\n6. Testing Returning Patient Intake with a Different Doctor...');
    // Pick another doctor or same doctor for a second visit
    try {
        const queueRes = await axios.post(`${API_BASE}/queue`, {
            patientId: aptPatient.id, // Sarah (who originally booked an appointment) comes in as walk-in
            doctorId: doctorId,
            priority: 'NORMAL'
        }, {
            headers: { Authorization: `Bearer ${recToken}` }
        });

        assert(queueRes.status === 201 && !!queueRes.data.tokenNumber,
            'Returning patient successfully issued walk-in ticket for consulting doctor',
            `Token: ${queueRes.data.tokenNumber}`);
        assert(queueRes.data.patientId === aptPatient.id, 'Queue entry maintains existing stable patientId');
        assert(queueRes.data.doctorId === doctorId, 'Queue entry stores doctorId for this visit');
    } catch (e: any) {
        assert(false, 'Returning patient queue intake failed', e.response?.data?.message || e.message);
    }

    // 7. Duplicate Queue Submission Prevention
    console.log('\n7. Testing Duplicate Submission Prevention...');
    try {
        await axios.post(`${API_BASE}/queue`, {
            patientId: aptPatient.id, // Same patient and doctor on the same day
            doctorId: doctorId,
            priority: 'NORMAL'
        }, {
            headers: { Authorization: `Bearer ${recToken}` }
        });
        assert(false, 'Duplicate queue entry should be rejected with 409 Conflict');
    } catch (dupErr: any) {
        assert(dupErr.response?.status === 409,
            'Duplicate queue entry correctly rejected with HTTP 409 Conflict',
            dupErr.response?.data?.message);
    }

    // 8. Validation: Ineligible / Missing Consulting Doctor
    console.log('\n8. Testing Ineligible & Missing Doctor Validation...');
    try {
        await axios.post(`${API_BASE}/patients`, {
            name: 'Invalid Doctor Test',
            phone: '+919999900001',
            age: 30,
            gender: 'Male',
            visitType: 'WALK_IN'
            // Missing doctorId
        }, {
            headers: { Authorization: `Bearer ${recToken}` }
        });
        assert(false, 'Registration with missing doctorId should be rejected');
    } catch (missErr: any) {
        assert(missErr.response?.status === 400,
            'Missing consulting doctor rejected with HTTP 400',
            missErr.response?.data?.message);
    }

    try {
        await axios.post(`${API_BASE}/patients`, {
            name: 'Nonexistent Doctor Test',
            phone: '+919999900002',
            age: 30,
            gender: 'Male',
            visitType: 'WALK_IN',
            doctorId: 'nonexistent-doc-uid-999'
        }, {
            headers: { Authorization: `Bearer ${recToken}` }
        });
        assert(false, 'Registration with nonexistent doctorId should be rejected');
    } catch (nonErr: any) {
        assert(nonErr.response?.status === 400,
            'Nonexistent/ineligible doctor rejected with HTTP 400',
            nonErr.response?.data?.message);
    }

    console.log('\n========================================================================');
    console.log(` RECEPTIONIST VERIFICATION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('========================================================================');

    if (failedCount > 0) {
        process.exit(1);
    }
}

run().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
