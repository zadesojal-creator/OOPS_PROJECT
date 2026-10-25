import { db } from '../firebase/admin';

const DOCTORS = [
    {
        name: "Rajesh Sharma",
        email: "rajesh.sharma@clinicqueue.internal",
        role: "DOCTOR",
        specialization: "General Physician",
        active: true,
        onDuty: true,
        room: "Cabin 101, Ground Floor",
        fee: "$35",
        schedule: {
            workingDays: [1, 2, 3, 4, 5, 6],
            startTime: "09:00",
            endTime: "18:00",
            lunchStart: "13:00",
            lunchEnd: "14:00",
            slotDurationMinutes: 20,
            maxAppointments: 25
        }
    },
    {
        name: "Priya Patel",
        email: "priya.patel@clinicqueue.internal",
        role: "DOCTOR",
        specialization: "Cardiologist",
        active: true,
        onDuty: true,
        room: "Cabin 204, 2nd Floor",
        fee: "$60",
        schedule: {
            workingDays: [1, 2, 3, 4, 5],
            startTime: "10:00",
            endTime: "16:00",
            lunchStart: "13:00",
            lunchEnd: "14:00",
            slotDurationMinutes: 30,
            maxAppointments: 15
        }
    },
    {
        name: "Ananya Sen",
        email: "ananya.sen@clinicqueue.internal",
        role: "DOCTOR",
        specialization: "Dermatologist",
        active: true,
        onDuty: true,
        room: "Cabin 105, 1st Floor",
        fee: "$50",
        schedule: {
            workingDays: [1, 2, 3, 4, 5, 6],
            startTime: "11:00",
            endTime: "16:00",
            lunchStart: "13:30",
            lunchEnd: "14:00",
            slotDurationMinutes: 20,
            maxAppointments: 20
        }
    },
    {
        name: "Vikram Verma",
        email: "vikram.verma@clinicqueue.internal",
        role: "DOCTOR",
        specialization: "Neurologist",
        active: true,
        onDuty: true,
        room: "Cabin 208, 2nd Floor",
        fee: "$75",
        schedule: {
            workingDays: [2, 4, 6],
            startTime: "14:00",
            endTime: "19:00",
            lunchStart: "16:00",
            lunchEnd: "16:30",
            slotDurationMinutes: 30,
            maxAppointments: 12
        }
    },
    {
        name: "Rohan Mehta",
        email: "rohan.mehta@clinicqueue.internal",
        role: "DOCTOR",
        specialization: "Orthopedic",
        active: true,
        onDuty: true,
        room: "Cabin 103, Ground Floor",
        fee: "$55",
        schedule: {
            workingDays: [1, 2, 3, 4, 5, 6],
            startTime: "09:30",
            endTime: "16:00",
            lunchStart: "13:00",
            lunchEnd: "14:00",
            slotDurationMinutes: 20,
            maxAppointments: 20
        }
    },
    {
        name: "Sunita Rao",
        email: "sunita.rao@clinicqueue.internal",
        role: "DOCTOR",
        specialization: "Pediatrician",
        active: true,
        onDuty: true,
        room: "Cabin 102, Ground Floor",
        fee: "$40",
        schedule: {
            workingDays: [1, 2, 3, 4, 5, 6],
            startTime: "09:00",
            endTime: "15:00",
            lunchStart: "12:30",
            lunchEnd: "13:00",
            slotDurationMinutes: 20,
            maxAppointments: 20
        }
    },
    {
        name: "Amit Deshmukh",
        email: "amit.deshmukh@clinicqueue.internal",
        role: "DOCTOR",
        specialization: "ENT",
        active: true,
        onDuty: true,
        room: "Cabin 107, 1st Floor",
        fee: "$45",
        schedule: {
            workingDays: [1, 2, 3, 4, 5],
            startTime: "15:00",
            endTime: "19:30",
            lunchStart: "17:00",
            lunchEnd: "17:30",
            slotDurationMinutes: 20,
            maxAppointments: 15
        }
    },
    {
        name: "Neha Kapoor",
        email: "neha.kapoor@clinicqueue.internal",
        role: "DOCTOR",
        specialization: "Dentist",
        active: true,
        onDuty: true,
        room: "Cabin 108, 1st Floor",
        fee: "$35",
        schedule: {
            workingDays: [1, 2, 3, 4, 5, 6],
            startTime: "10:00",
            endTime: "18:00",
            lunchStart: "13:00",
            lunchEnd: "14:00",
            slotDurationMinutes: 30,
            maxAppointments: 15
        }
    }
];

async function seed() {
    console.log('Seeding doctors and schedules into Firestore...');
    for (const doc of DOCTORS) {
        const snap = await db.collection('users').where('name', '==', doc.name).get();
        let docId = '';
        if (snap.empty) {
            const ref = db.collection('users').doc();
            docId = ref.id;
            await ref.set({
                uid: docId,
                name: doc.name,
                email: doc.email,
                role: doc.role,
                specialization: doc.specialization,
                active: doc.active,
                onDuty: doc.onDuty,
                room: doc.room,
                fee: doc.fee,
                createdAt: new Date().toISOString()
            });
            console.log(`Created doctor user: Dr. ${doc.name} (${doc.specialization}) [${docId}]`);
        } else {
            docId = snap.docs[0].id;
            await db.collection('users').doc(docId).update({
                specialization: doc.specialization,
                active: true,
                onDuty: true,
                room: doc.room,
                fee: doc.fee
            });
            console.log(`Updated doctor user: Dr. ${doc.name}`);
        }

        await db.collection('doctor_schedules').doc(docId).set({
            doctorId: docId,
            ...doc.schedule
        }, { merge: true });
        console.log(`Saved schedule for Dr. ${doc.name}`);
    }
    console.log('Seeding complete!');
    process.exit(0);
}

seed().catch(err => {
    console.error('Seeding error:', err);
    process.exit(1);
});
