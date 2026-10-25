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
    console.log('===============================================================');
    console.log(' CLINICQUEUE APPOINTMENTS & SYSTEM VERIFICATION SUITE');
    console.log('===============================================================\n');

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

    // 1. Authenticate users
    console.log('1. Authenticating test users...');
    const adminToken = await getIdToken('admin@gmail.com', 'Admin@123');
    const doctorToken = await getIdToken('doctor@gmail.com', 'Doctor@123');
    const receptionistToken = await getIdToken('receptionist@gmail.com', 'Receptionist@123');
    
    // Ensure patient test user
    const patientEmail = 'patient.test@clinicqueue.internal';
    let patientUid = '';
    try {
        const u = await auth.getUserByEmail(patientEmail);
        patientUid = u.uid;
    } catch {
        const u = await auth.createUser({ email: patientEmail, password: 'Patient@12345', displayName: 'Alice Patient' });
        patientUid = u.uid;
    }
    const patientToken = await getIdToken(patientEmail, 'Patient@12345');
    
    // Fetch doctor record
    const doctorUser = await auth.getUserByEmail('doctor@gmail.com');
    const doctorUid = doctorUser.uid;

    // Fetch or create a test patient document
    let testPatientId = 'patient-test-rec';
    const pSnap = await db.collection('patients').doc(testPatientId).get();
    if (!pSnap.exists) {
        await db.collection('patients').doc(testPatientId).set({
            name: 'Alice Patient Test',
            phone: '+919876543210',
            age: 34,
            gender: 'Female',
            email: patientEmail,
            createdAt: new Date().toISOString()
        });
    }
    // Update user profile with patientId
    await db.collection('users').doc(patientUid).set({
        uid: patientUid,
        email: patientEmail,
        name: 'Alice Patient',
        role: 'PATIENT',
        patientId: testPatientId
    }, { merge: true });

    assert(!!adminToken && !!doctorToken && !!patientToken, 'All roles successfully authenticated');

    // 2. Test Available Slots via C++ Engine
    console.log('\n2. Testing Available Slots Engine (GET /api/appointments/available-slots)...');
    // Use tomorrow or next Monday
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    const targetDate = tomorrow.toISOString().split('T')[0];

    let availableSlotsRes: any;
    try {
        const res = await axios.get(`${API_BASE}/appointments/available-slots`, {
            params: { doctorId: doctorUid, date: targetDate },
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        availableSlotsRes = res.data;
        assert(Array.isArray(availableSlotsRes.slots) && availableSlotsRes.available !== undefined,
            'Available slots returned valid schema',
            `slots=${availableSlotsRes.slots?.length}, available=${availableSlotsRes.available}`);
        assert(typeof availableSlotsRes.totalSlots === 'number' && typeof availableSlotsRes.remaining === 'number',
            'Slot capacity metrics included (totalSlots, remaining, booked)');
    } catch (e: any) {
        assert(false, 'Available slots endpoint returned error', e.response?.data?.message || e.message);
    }

    // 3. Test RBAC Scoping for Doctor Role
    console.log('\n3. Testing Doctor RBAC Scoping (Doctor only sees their appointments)...');
    try {
        const docRes = await axios.get(`${API_BASE}/appointments`, {
            headers: { Authorization: `Bearer ${doctorToken}` }
        });
        const doctorApts = docRes.data;
        const allMatchDoctor = doctorApts.every((a: any) => a.doctorId === doctorUid);
        assert(allMatchDoctor, 'All appointments returned for Doctor belong to their doctorId');

        // Test that Doctor cannot query another doctor's appointments
        try {
            await axios.get(`${API_BASE}/appointments?doctorId=other-doc-id`, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });
            assert(false, 'Doctor querying another doctor ID should be rejected');
        } catch (e: any) {
            assert(e.response?.status === 403, 'Doctor querying another doctor receives 403 Forbidden');
        }
    } catch (e: any) {
        assert(false, 'Doctor appointments check failed', e.message);
    }

    // 4. Test RBAC Scoping for Patient Role
    console.log('\n4. Testing Patient RBAC Scoping (Patient only sees own appointments)...');
    try {
        const patRes = await axios.get(`${API_BASE}/appointments`, {
            headers: { Authorization: `Bearer ${patientToken}` }
        });
        const patientApts = patRes.data;
        const allMatchPatient = patientApts.every((a: any) => a.patientId === testPatientId);
        assert(allMatchPatient, 'All appointments returned for Patient belong to their patientId');

        // Test that Patient cannot query another patient's appointments
        try {
            await axios.get(`${API_BASE}/appointments?patientId=unauthorized-other-patient`, {
                headers: { Authorization: `Bearer ${patientToken}` }
            });
            assert(false, 'Patient querying another patient ID should be rejected');
        } catch (e: any) {
            assert(e.response?.status === 403, 'Patient querying another patient receives 403 Forbidden');
        }
    } catch (e: any) {
        assert(false, 'Patient appointments check failed', e.message);
    }

    // 5. Test Receptionist & Admin Multi-filtering
    console.log('\n5. Testing Multi-filter capabilities (status, search, specialization)...');
    try {
        const filterRes = await axios.get(`${API_BASE}/appointments`, {
            params: { status: 'BOOKED', checkInStatus: 'NOT_ARRIVED' },
            headers: { Authorization: `Bearer ${receptionistToken}` }
        });
        assert(Array.isArray(filterRes.data), 'Receptionist can filter appointments by status and checkInStatus');
    } catch (e: any) {
        assert(false, 'Receptionist multi-filtering failed', e.message);
    }

    // 6. Test Atomic Booking with Interval EndTime & StartAt
    console.log('\n6. Testing Atomic Booking (POST /api/appointments) & Conflict Prevention...');
    let createdApt: any;
    const testSlot = availableSlotsRes?.slots?.[0] || '10:00';

    try {
        const bookRes = await axios.post(`${API_BASE}/appointments`, {
            doctorId: doctorUid,
            patientId: testPatientId,
            date: targetDate,
            startTime: testSlot,
            notes: 'Automated test consultation',
            priority: 'NORMAL',
            source: 'WEB'
        }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });

        createdApt = bookRes.data;
        assert(bookRes.status === 201 && !!createdApt.id, 'Appointment created with HTTP 201');
        assert(createdApt.startTime === testSlot && !!createdApt.endTime,
            'Appointment contains computed endTime interval',
            `${createdApt.startTime} - ${createdApt.endTime}`);
        assert(!!createdApt.startAt && !!createdApt.endAt, 'Appointment contains ISO startAt and endAt timestamps');
        assert(createdApt.status === 'BOOKED' && createdApt.checkInStatus === 'NOT_ARRIVED',
            'Appointment has status=BOOKED and checkInStatus=NOT_ARRIVED');
        assert(!!createdApt.doctorSpecialization, 'Appointment has doctorSpecialization enriched');

        // Test Conflict Prevention: attempting to book the EXACT same slot
        console.log('   Testing concurrent/double booking prevention on same slot...');
        try {
            await axios.post(`${API_BASE}/appointments`, {
                doctorId: doctorUid,
                patientId: testPatientId,
                date: targetDate,
                startTime: testSlot
            }, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            assert(false, 'Double booking identical slot should be rejected');
        } catch (confErr: any) {
            assert(confErr.response?.status === 409, 'Double booking identical slot rejected with HTTP 409 Conflict', confErr.response?.data?.message);
        }
    } catch (e: any) {
        assert(false, 'Appointment booking failed', e.response?.data?.message || e.message);
    }

    // 7. Test Appointment Retrieval by ID (GET /api/appointments/:id)
    console.log('\n7. Testing Appointment Retrieval (GET /api/appointments/:id)...');
    if (createdApt?.id) {
        try {
            const detailRes = await axios.get(`${API_BASE}/appointments/${createdApt.id}`, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            const detail = detailRes.data;
            assert(detail.id === createdApt.id, 'GET /appointments/:id returns correct appointment');
            assert(!!detail.doctorName && !!detail.patientName, 'GET /appointments/:id includes doctor and patient metadata');
        } catch (e: any) {
            assert(false, 'GET /appointments/:id failed', e.message);
        }
    }

    // 8. Test Check-In Workflow (POST /api/appointments/:id/checkin)
    console.log('\n8. Testing Check-In & Live Queue Integration (POST /api/appointments/:id/checkin)...');
    // Create an appointment for TODAY to test check-in
    const todayStr = new Date().toISOString().split('T')[0];
    let todayApt: any;
    try {
        const slotsToday = await axios.get(`${API_BASE}/appointments/available-slots`, {
            params: { doctorId: doctorUid, date: todayStr },
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        const freeSlot = slotsToday.data.slots?.[0] || '15:20';
        const todayBookRes = await axios.post(`${API_BASE}/appointments`, {
            doctorId: doctorUid,
            patientId: testPatientId,
            date: todayStr,
            startTime: freeSlot,
            notes: 'Today check-in test'
        }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });

        todayApt = todayBookRes.data;

        // Perform check-in
        const checkinRes = await axios.post(`${API_BASE}/appointments/${todayApt.id}/checkin`, {
            priority: 'NORMAL'
        }, {
            headers: { Authorization: `Bearer ${receptionistToken}` }
        });

        const checkinData = checkinRes.data;
        assert(!!checkinData.tokenNumber && !!checkinData.queueId,
            'Check-in generates live queue tokenNumber and queueId',
            `Token: ${checkinData.tokenNumber}`);

        // Verify appointment document updated
        const verifyAptDoc = await db.collection('appointments').doc(todayApt.id).get();
        const updatedApt = verifyAptDoc.data();
        assert(updatedApt?.status === 'CHECKED_IN' && updatedApt?.checkInStatus === 'CHECKED_IN',
            'Appointment document updated with status=CHECKED_IN and checkInStatus=CHECKED_IN');
        assert(!!updatedApt?.queueToken && !!updatedApt?.checkedInAt,
            'Appointment document links queueToken and checkedInAt');

        // Verify double check-in rejected
        try {
            await axios.post(`${API_BASE}/appointments/${todayApt.id}/checkin`, {}, {
                headers: { Authorization: `Bearer ${receptionistToken}` }
            });
            assert(false, 'Double check-in should be rejected');
        } catch (e: any) {
            assert(e.response?.status === 409, 'Double check-in rejected with 409 Conflict');
        }
    } catch (e: any) {
        assert(false, 'Check-in test failed', e.response?.data?.message || e.message);
    }

    // 9. Test Completion Workflow (PATCH /api/appointments/:id/complete)
    console.log('\n9. Testing Completion (PATCH /api/appointments/:id/complete)...');
    if (todayApt?.id) {
        try {
            const compRes = await axios.patch(`${API_BASE}/appointments/${todayApt.id}/complete`, {}, {
                headers: { Authorization: `Bearer ${doctorToken}` }
            });
            assert(compRes.data.status === 'COMPLETED' && !!compRes.data.completedAt,
                'Appointment marked as COMPLETED by attending physician');
            
            const aptDoc = await db.collection('appointments').doc(todayApt.id).get();
            assert(aptDoc.data()?.status === 'COMPLETED', 'Appointment doc status persisted as COMPLETED in Firestore');
        } catch (e: any) {
            assert(false, 'Complete appointment failed', e.message);
        }
    }

    // 10. Test Cancellation Workflow (PATCH /api/appointments/:id/cancel)
    console.log('\n10. Testing Cancellation (PATCH /api/appointments/:id/cancel)...');
    if (createdApt?.id) {
        try {
            const cancelRes = await axios.patch(`${API_BASE}/appointments/${createdApt.id}/cancel`, {}, {
                headers: { Authorization: `Bearer ${adminToken}` }
            });
            assert(cancelRes.data.status === 'CANCELLED', 'Appointment cancelled successfully');

            const cancelDoc = await db.collection('appointments').doc(createdApt.id).get();
            assert(cancelDoc.data()?.status === 'CANCELLED', 'Appointment doc status persisted as CANCELLED');
        } catch (e: any) {
            assert(false, 'Cancel appointment failed', e.message);
        }
    }

    // 11. Test Patient Portal Family Endpoint (GET /api/patient-portal/family)
    console.log('\n11. Testing Patient Family Members (GET /api/patient-portal/family)...');
    try {
        const famRes = await axios.get(`${API_BASE}/patient-portal/family`, {
            headers: { Authorization: `Bearer ${patientToken}` }
        });
        assert(Array.isArray(famRes.data.members) && !!famRes.data.primaryPatientId,
            'Family endpoint returns members array and primaryPatientId');
    } catch (e: any) {
        assert(false, 'Patient family endpoint failed', e.message);
    }

    console.log('\n===============================================================');
    console.log(` VERIFICATION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('===============================================================');

    if (failedCount > 0) {
        process.exit(1);
    }
}

run().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
