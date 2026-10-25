import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { db, formatDoc } from '../firebase/admin';
import { CppEngine } from '../cpp-adapter/CppEngine';
import { DoctorSyncService } from '../services/DoctorSyncService';

const router = Router();

// GET /api/doctors
router.get('/doctors', authenticate, async (req, res) => {
    const { specialization, onDutyOnly } = req.query as { specialization?: string; onDutyOnly?: string };
    const snapshot = await db.collection('users').where('role', '==', 'DOCTOR').where('active', '==', true).get();
    let doctors = snapshot.docs.map(formatDoc);

    if (specialization && specialization !== 'ALL') {
        const specLower = specialization.toLowerCase();
        doctors = doctors.filter(d => (d.specialization || '').toLowerCase() === specLower);
    }

    if (onDutyOnly === 'true') {
        doctors = doctors.filter(d => d.onDuty !== false);
    }

    res.json(doctors);
});

// GET /api/specializations
router.get('/specializations', async (req, res) => {
    const defaultSpecs = ["General Physician", "Cardiologist", "Dermatologist", "Neurologist", "Orthopedic", "Pediatrician", "ENT", "Dentist"];
    try {
        const snapshot = await db.collection('users').where('role', '==', 'DOCTOR').where('active', '==', true).get();
        const activeDoctorSpecs = snapshot.docs.map(d => d.data().specialization).filter(Boolean);
        const allSpecs = Array.from(new Set([...defaultSpecs, ...activeDoctorSpecs])).sort();
        res.json(allSpecs);
    } catch {
        res.json(defaultSpecs);
    }
});

// GET /api/doctors/:id/schedule
router.get('/doctors/:id/schedule', authenticate, async (req, res) => {
    const doc = await db.collection('doctor_schedules').doc(req.params.id).get();
    if (!doc.exists) {
        return res.json({
            doctorId: req.params.id,
            workingDays: [1, 2, 3, 4, 5, 6],
            startTime: "09:00", endTime: "17:00",
            lunchStart: "13:00", lunchEnd: "14:00",
            slotDurationMinutes: 20, maxAppointments: 20
        });
    }
    res.json(formatDoc(doc));
});

// POST /api/doctors/:id/schedule
router.post('/doctors/:id/schedule', authenticate, authorize(['ADMIN', 'DOCTOR']), async (req, res) => {
    const schedule = { ...req.body, doctorId: req.params.id };
    if (schedule.specialization) {
        await db.collection('users').doc(req.params.id).update({ specialization: schedule.specialization });
        delete schedule.specialization;
    }
    await db.collection('doctor_schedules').doc(req.params.id).set(schedule, { merge: true });

    // Auto-sync knowledge base and AI RAG
    await DoctorSyncService.syncDoctorsKnowledgeBase().catch(err => {
        console.error('[doctors.ts] Error auto-syncing doctor schedule to knowledge base:', err);
    });

    res.json(schedule);
});

// PATCH /api/doctors/:id
router.patch('/doctors/:id', authenticate, authorize(['ADMIN', 'DOCTOR']), async (req, res) => {
    const doctorId = req.params.id;
    const { name, specialization, room, fee, phone, email, active, onDuty } = req.body;

    const userRef = db.collection('users').doc(doctorId);
    const docSnap = await userRef.get();
    if (!docSnap.exists) {
        return res.status(404).json({ message: 'Doctor not found' });
    }

    const updates: any = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (specialization !== undefined) updates.specialization = specialization.trim();
    if (room !== undefined) updates.room = room.trim();
    if (fee !== undefined) updates.fee = fee.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (email !== undefined) updates.email = email.trim().toLowerCase();
    if (typeof active === 'boolean') updates.active = active;
    if (typeof onDuty === 'boolean') updates.onDuty = onDuty;

    await userRef.update(updates);

    // Auto-sync knowledge base and AI RAG
    await DoctorSyncService.syncDoctorsKnowledgeBase().catch(err => {
        console.error('[doctors.ts] Error auto-syncing doctor profile update to knowledge base:', err);
    });

    res.json({ id: doctorId, ...docSnap.data(), ...updates, message: 'Doctor updated and synced successfully' });
});

// PUT /api/doctors/:id (alias to PATCH)
router.put('/doctors/:id', authenticate, authorize(['ADMIN', 'DOCTOR']), async (req, res) => {
    const doctorId = req.params.id;
    const { name, specialization, room, fee, phone, email, active, onDuty } = req.body;

    const userRef = db.collection('users').doc(doctorId);
    const docSnap = await userRef.get();
    if (!docSnap.exists) {
        return res.status(404).json({ message: 'Doctor not found' });
    }

    const updates: any = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (specialization !== undefined) updates.specialization = specialization.trim();
    if (room !== undefined) updates.room = room.trim();
    if (fee !== undefined) updates.fee = fee.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (email !== undefined) updates.email = email.trim().toLowerCase();
    if (typeof active === 'boolean') updates.active = active;
    if (typeof onDuty === 'boolean') updates.onDuty = onDuty;

    await userRef.update(updates);

    await DoctorSyncService.syncDoctorsKnowledgeBase().catch(err => {
        console.error('[doctors.ts] Error auto-syncing doctor profile update to knowledge base:', err);
    });

    res.json({ id: doctorId, ...docSnap.data(), ...updates, message: 'Doctor updated and synced successfully' });
});

// GET /api/doctors/:id/holidays
router.get('/doctors/:id/holidays', authenticate, async (req, res) => {
    const snapshot = await db.collection('doctor_holidays').where('doctorId', '==', req.params.id).get();
    res.json(snapshot.docs.map(formatDoc));
});

// POST /api/doctors/:id/holidays
router.post('/doctors/:id/holidays', authenticate, authorize(['ADMIN', 'DOCTOR']), async (req, res) => {
    const hRef = db.collection('doctor_holidays').doc();
    const data = { ...req.body, doctorId: req.params.id };
    await hRef.set(data);
    res.json({ id: hRef.id, ...data });
});

// DELETE /api/doctors/:id/holidays/:hid
router.delete('/doctors/:id/holidays/:hid', authenticate, authorize(['ADMIN', 'DOCTOR']), async (req, res) => {
    await db.collection('doctor_holidays').doc(req.params.hid).delete();
    res.json({ id: req.params.hid, deleted: true });
});

// GET /api/doctors/:id/availability
router.get('/doctors/:id/availability', authenticate, async (req, res) => {
    const dateStr = req.query.date as string;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ message: 'Invalid date format' });

    const doctorId = req.params.id;

    const [hols, schedDoc, apts] = await Promise.all([
        db.collection('doctor_holidays').where('doctorId', '==', doctorId).where('date', '==', dateStr).get(),
        db.collection('doctor_schedules').doc(doctorId).get(),
        db.collection('appointments').where('doctorId', '==', doctorId).where('date', '==', dateStr).get()
    ]);

    if (!hols.empty) {
        return res.json({ slots: [], available: false, reason: 'Holiday' });
    }

    const schedule = schedDoc.exists ? schedDoc.data() : {
        workingDays: [1, 2, 3, 4, 5, 6],
        startTime: "09:00", endTime: "17:00",
        lunchStart: "13:00", lunchEnd: "14:00",
        slotDurationMinutes: 20, maxAppointments: 20
    };

    const bookedSlots: string[] = [];
    apts.forEach(doc => {
        const a = doc.data();
        if (a.status !== 'CANCELLED') bookedSlots.push(a.startTime);
    });

    try {
        const result = await CppEngine.execute('generateSlots', {
            startTime: schedule?.startTime,
            endTime: schedule?.endTime,
            lunchStart: schedule?.lunchStart,
            lunchEnd: schedule?.lunchEnd,
            slotDurationMinutes: schedule?.slotDurationMinutes,
            workingDays: schedule?.workingDays,
            bookedSlots,
            targetDate: dateStr,
            nowUtc: new Date().toISOString()
        });

        const slots = result.slots || [];
        res.json({
            slots,
            totalSlots: slots.length + bookedSlots.length,
            booked: bookedSlots.length,
            remaining: slots.length,
            maxAppointments: schedule?.maxAppointments
        });
    } catch (e: any) {
        res.status(502).json({ message: e.message });
    }
});

export default router;
