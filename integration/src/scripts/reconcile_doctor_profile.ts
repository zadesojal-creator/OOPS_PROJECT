import { db } from '../firebase/admin';

async function reconcileDoctor() {
    console.log('Reconciling Doctor Profile for JLrccV1bVSWx77drKgaJsTwC6K93 (doctor@gmail.com)...');

    const doctorUid = 'JLrccV1bVSWx77drKgaJsTwC6K93';
    const seededDoctorUid = 'IvhkuB8pjNfuWagBXrGn';

    // 1. Fetch seeded doctor info if available
    const seededUserDoc = await db.collection('users').doc(seededDoctorUid).get();
    const seededSchedDoc = await db.collection('doctor_schedules').doc(seededDoctorUid).get();

    const scheduleData = seededSchedDoc.exists ? seededSchedDoc.data() : {
        doctorId: doctorUid,
        workingDays: [1, 2, 3, 4, 5, 6],
        startTime: '09:00',
        endTime: '18:00',
        lunchStart: '13:00',
        lunchEnd: '14:00',
        slotDurationMinutes: 20,
        maxAppointments: 25
    };

    // Update doctor_schedules for doctorUid
    await db.collection('doctor_schedules').doc(doctorUid).set({
        ...scheduleData,
        doctorId: doctorUid,
        updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`Updated doctor_schedules for ${doctorUid}`);

    // Update users doc for doctorUid
    await db.collection('users').doc(doctorUid).set({
        uid: doctorUid,
        role: 'DOCTOR',
        name: 'Dr. Rajesh Sharma',
        email: 'doctor@gmail.com',
        specialization: 'General Physician',
        room: 'Cabin 101, Ground Floor',
        fee: '$35',
        active: true,
        onDuty: true,
        updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`Updated users profile for ${doctorUid}`);

    // Mark the duplicate seeded user inactive to avoid duplicate entries in doctor dropdowns
    if (seededUserDoc.exists) {
        await db.collection('users').doc(seededDoctorUid).update({
            active: false,
            mergedInto: doctorUid,
            updatedAt: new Date().toISOString()
        });
        console.log(`Marked duplicate seeded doctor ${seededDoctorUid} as inactive (mergedInto ${doctorUid})`);
    }

    // Reconcile any appointments under seededDoctorUid to doctorUid
    const aptsSnap = await db.collection('appointments').where('doctorId', '==', seededDoctorUid).get();
    console.log(`Migrating ${aptsSnap.size} appointment(s) from ${seededDoctorUid} to ${doctorUid}...`);
    for (const doc of aptsSnap.docs) {
        await doc.ref.update({
            doctorId: doctorUid,
            doctorName: 'Dr. Rajesh Sharma',
            migratedFrom: seededDoctorUid
        });
    }

    // Reconcile any consultations under seededDoctorUid to doctorUid
    const consultsSnap = await db.collection('consultations').where('doctorId', '==', seededDoctorUid).get();
    console.log(`Migrating ${consultsSnap.size} consultation(s) from ${seededDoctorUid} to ${doctorUid}...`);
    for (const doc of consultsSnap.docs) {
        await doc.ref.update({
            doctorId: doctorUid,
            doctorName: 'Dr. Rajesh Sharma',
            migratedFrom: seededDoctorUid
        });
    }

    // Also ensure today has at least one test appointment for Dr. Rajesh Sharma to verify on dashboard
    const today = new Date().toISOString().split('T')[0];
    const todayAptsSnap = await db.collection('appointments').where('doctorId', '==', doctorUid).where('date', '==', today).get();
    console.log(`Dr. Rajesh Sharma has ${todayAptsSnap.size} appointment(s) today (${today}).`);

    console.log('Doctor profile reconciliation complete!');
    process.exit(0);
}

reconcileDoctor().catch(e => {
    console.error('Reconciliation failed:', e);
    process.exit(1);
});
