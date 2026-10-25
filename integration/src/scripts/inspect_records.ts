import { db } from '../firebase/admin';

async function inspect() {
    console.log('=== INSPECTION OF FIRESTORE DATA ===\n');

    // 1. Patients inspection
    const patientsSnap = await db.collection('patients').get();
    console.log(`Total Patients: ${patientsSnap.size}`);
    const phoneMap = new Map<string, string[]>();
    patientsSnap.forEach(d => {
        const p = d.data();
        const cleanPhone = (p.phone || '').replace(/\D/g, '');
        if (cleanPhone) {
            const list = phoneMap.get(cleanPhone) || [];
            list.push(`${d.id} (${p.name}, age ${p.age})`);
            phoneMap.set(cleanPhone, list);
        }
    });

    console.log('\nShared Phone Numbers among Patients:');
    let sharedCount = 0;
    phoneMap.forEach((ids, phone) => {
        if (ids.length > 1) {
            sharedCount++;
            console.log(`Phone ${phone} shared by ${ids.length} patients:`, ids);
        }
    });
    if (sharedCount === 0) console.log('No shared phone numbers found in current patient records.');

    // 2. Doctor user and schedule inspection
    const doctorsSnap = await db.collection('users').where('role', '==', 'DOCTOR').get();
    console.log(`\nTotal Doctors in users: ${doctorsSnap.size}`);
    for (const d of doctorsSnap.docs) {
        const data = d.data();
        const schedDoc = await db.collection('doctor_schedules').doc(d.id).get();
        console.log(`Doctor: Dr. ${data.name} [ID: ${d.id}, Email: ${data.email}] -> Schedule exists: ${schedDoc.exists}`);
    }

    // 3. Appointments inspection
    const aptsSnap = await db.collection('appointments').get();
    console.log(`\nTotal Appointments: ${aptsSnap.size}`);
    let missingPatientIdApts = 0;
    let missingDoctorIdApts = 0;
    aptsSnap.forEach(d => {
        const a = d.data();
        if (!a.patientId) missingPatientIdApts++;
        if (!a.doctorId) missingDoctorIdApts++;
    });
    console.log(`Appointments missing patientId: ${missingPatientIdApts}`);
    console.log(`Appointments missing doctorId: ${missingDoctorIdApts}`);

    // 4. Queue inspection
    const queueSnap = await db.collection('queue').get();
    console.log(`\nTotal Queue Tokens: ${queueSnap.size}`);

    // 5. Consultations & Prescriptions
    const cSnap = await db.collection('consultations').get();
    const pSnap = await db.collection('prescriptions').get();
    console.log(`Total Consultations: ${cSnap.size}`);
    console.log(`Total Prescriptions: ${pSnap.size}`);

    process.exit(0);
}

inspect();
