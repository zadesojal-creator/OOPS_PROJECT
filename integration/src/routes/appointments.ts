import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { db, formatDoc } from '../firebase/admin';
import { CppEngine } from '../cpp-adapter/CppEngine';

const router = Router();

function computeEndTime(startTime: string, durationMinutes: number = 20): string {
    const parts = startTime.split(':').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return startTime;
    const totalMins = parts[0] * 60 + parts[1] + durationMinutes;
    const endH = Math.floor(totalMins / 60) % 24;
    const endM = totalMins % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

// GET /api/appointments/available-slots
router.get('/available-slots', authenticate, async (req, res) => {
    const doctorId = req.query.doctorId as string;
    const dateStr = req.query.date as string;

    if (!doctorId || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ message: 'doctorId and a valid date (YYYY-MM-DD) are required.' });
    }

    const [hols, schedDoc, apts] = await Promise.all([
        db.collection('doctor_holidays').where('doctorId', '==', doctorId).where('date', '==', dateStr).get(),
        db.collection('doctor_schedules').doc(doctorId).get(),
        db.collection('appointments').where('doctorId', '==', doctorId).where('date', '==', dateStr).get()
    ]);

    if (!hols.empty) {
        return res.json({ slots: [], available: false, reason: hols.docs[0].data()?.reason || 'Holiday / Leave' });
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

    if (schedule?.maxAppointments && bookedSlots.length >= schedule.maxAppointments) {
        return res.json({
            slots: [],
            available: false,
            reason: `Doctor has reached maximum appointment capacity (${schedule.maxAppointments}) for this date.`,
            booked: bookedSlots.length,
            maxAppointments: schedule.maxAppointments
        });
    }

    try {
        const result = await CppEngine.execute('generateSlots', {
            startTime: schedule?.startTime || "09:00",
            endTime: schedule?.endTime || "17:00",
            lunchStart: schedule?.lunchStart || "13:00",
            lunchEnd: schedule?.lunchEnd || "14:00",
            slotDurationMinutes: schedule?.slotDurationMinutes || 20,
            workingDays: schedule?.workingDays || [1, 2, 3, 4, 5, 6],
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
            maxAppointments: schedule?.maxAppointments,
            available: slots.length > 0
        });
    } catch (e: any) {
        res.status(502).json({ message: e.message });
    }
});

// GET /api/appointments
router.get('/', authenticate, async (req, res) => {
    let { doctorId, patientId, date, status, checkInStatus, specialization, search } = req.query as {
        doctorId?: string;
        patientId?: string;
        date?: string;
        status?: string;
        checkInStatus?: string;
        specialization?: string;
        search?: string;
    };

    if (req.profile.role === 'PATIENT') {
        const myPatientId = req.profile.patientId;
        if (patientId && patientId !== myPatientId) {
            // Check if patientId belongs to an authorized family member
            const familySnap = await db.collection('familyMembers')
                .where('patientId', '==', patientId)
                .where('isVerified', '==', true)
                .get();
            const isFamilyMember = familySnap.docs.some(doc => {
                const d = doc.data();
                return d.chatId && (d.patientId === myPatientId || d.patientId === patientId);
            });
            if (!isFamilyMember) {
                return res.status(403).json({ message: 'Access denied. You can only view your own or authorized family appointments.' });
            }
        } else {
            patientId = myPatientId;
        }
    }

    if (req.profile.role === 'DOCTOR') {
        const myDoctorId = req.profile.uid;
        if (doctorId && doctorId !== myDoctorId) {
            return res.status(403).json({ message: 'Access denied. You can only view your own appointments.' });
        }
        doctorId = myDoctorId;
    }
    
    let query: FirebaseFirestore.Query = db.collection('appointments');
    if (doctorId) query = query.where('doctorId', '==', doctorId);
    if (patientId) query = query.where('patientId', '==', patientId);
    if (date) query = query.where('date', '==', date);
    if (status && status !== 'ALL') query = query.where('status', '==', status);
    
    const snapshot = await query.get();
    let apts = snapshot.docs.map(formatDoc);

    // In-memory filters for checkInStatus, specialization, and search
    if (checkInStatus && checkInStatus !== 'ALL') {
        apts = apts.filter(a => {
            const actualCheckIn = a.checkInStatus || (a.status === 'CHECKED_IN' ? 'CHECKED_IN' : 'NOT_ARRIVED');
            return actualCheckIn === checkInStatus;
        });
    }

    if (specialization && specialization !== 'ALL') {
        const specLower = specialization.toLowerCase();
        apts = apts.filter(a => (a.doctorSpecialization || '').toLowerCase().includes(specLower));
    }

    if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        apts = apts.filter(a =>
            (a.patientName || '').toLowerCase().includes(q) ||
            (a.id || '').toLowerCase().includes(q) ||
            (a.doctorName || '').toLowerCase().includes(q) ||
            (a.queueToken || '').toLowerCase().includes(q)
        );
    }

    // In-memory sort by date desc, startTime asc
    apts.sort((a, b) => {
        const dateCmp = (b.date || '').localeCompare(a.date || '');
        if (dateCmp !== 0) return dateCmp;
        return (a.startTime || '').localeCompare(b.startTime || '');
    });

    res.json(apts);
});

// GET /api/appointments/:id
router.get('/:id', authenticate, async (req, res) => {
    try {
        const aptRef = db.collection('appointments').doc(req.params.id);
        const aptDoc = await aptRef.get();
        if (!aptDoc.exists) return res.status(404).json({ message: 'Appointment not found' });
        const apt = formatDoc(aptDoc);

        // RBAC: Doctor sees only their own appointments
        if (req.profile.role === 'DOCTOR' && apt.doctorId !== req.profile.uid) {
            return res.status(403).json({ message: 'Access denied. You can only view your own appointments.' });
        }

        // RBAC: Patient sees only their own or authorized family appointments
        if (req.profile.role === 'PATIENT' && apt.patientId !== req.profile.patientId) {
            const familySnap = await db.collection('familyMembers')
                .where('patientId', '==', apt.patientId)
                .where('isVerified', '==', true)
                .get();
            const isFamilyMember = familySnap.docs.some(doc => {
                const d = doc.data();
                return d.chatId && (d.patientId === req.profile.patientId || d.patientId === apt.patientId);
            });
            if (!isFamilyMember) {
                return res.status(403).json({ message: 'Access denied. You can only view your own appointments.' });
            }
        }

        // Attach live queue information if checked in
        if (apt.queueId) {
            const qDoc = await db.collection('queue').doc(apt.queueId).get();
            if (qDoc.exists) {
                apt.queue = formatDoc(qDoc);
            }
        } else if (apt.queueToken) {
            const qSnap = await db.collection('queue').where('tokenNumber', '==', apt.queueToken).limit(1).get();
            if (!qSnap.empty) {
                apt.queue = formatDoc(qSnap.docs[0]);
            }
        }

        // Ensure doctor details are enriched if missing
        if (!apt.doctorSpecialization || !apt.doctorRoom) {
            const dDoc = await db.collection('users').doc(apt.doctorId).get();
            if (dDoc.exists) {
                const d = dDoc.data()!;
                apt.doctorSpecialization = apt.doctorSpecialization || d.specialization || 'General Practitioner';
                apt.doctorRoom = apt.doctorRoom || d.room || d.cabin || 'Consultation Room';
            }
        }

        // Ensure patient contact details are enriched if missing
        if (!apt.patientPhone || !apt.patientAge) {
            const pDoc = await db.collection('patients').doc(apt.patientId).get();
            if (pDoc.exists) {
                const p = pDoc.data()!;
                apt.patientPhone = apt.patientPhone || p.phone || '';
                apt.patientAge = apt.patientAge || p.age || null;
                apt.patientGender = apt.patientGender || p.gender || '';
            }
        }

        res.json(apt);
    } catch (e: any) {
        res.status(500).json({ message: e.message || 'Failed to fetch appointment' });
    }
});

// POST /api/appointments
router.post('/', authenticate, async (req, res) => {
    let { doctorId, patientId, date, startTime, source = 'WEB', notes = '', priority = 'NORMAL', specialization } = req.body;

    if (req.profile.role === 'PATIENT') {
        patientId = req.profile.patientId;
    }
    
    if (!doctorId || !patientId || !date || !startTime) {
        return res.status(400).json({ message: 'doctorId, patientId, date, and startTime are required' });
    }

    // Using a transaction to prevent concurrent bookings for the exact same slot
    try {
        const result = await db.runTransaction(async (t) => {
            // 1. Fetch schedules, holidays, and booked slots for validation
            const schedDoc = await t.get(db.collection('doctor_schedules').doc(doctorId));
            const holDocs = await t.get(db.collection('doctor_holidays').where('doctorId', '==', doctorId).where('date', '==', date));
            const aptDocs = await t.get(db.collection('appointments').where('doctorId', '==', doctorId).where('date', '==', date));

            const schedule = schedDoc.exists ? schedDoc.data() : { maxAppointments: 20, slotDurationMinutes: 20 };
            const holidays = holDocs.docs.map(d => d.data());
            
            const bookedSlots: string[] = [];
            aptDocs.forEach(d => {
                const a = d.data();
                if (a.status !== 'CANCELLED') bookedSlots.push(a.startTime);
            });

            // 2. Validate using C++ engine
            const validationResult = await CppEngine.execute('validateAppointment', {
                maxAppointments: schedule?.maxAppointments,
                holidays,
                bookedSlots,
                date,
                time: startTime
            });

            // 3. Create appointment
            const pDoc = await t.get(db.collection('patients').doc(patientId));
            const dDoc = await t.get(db.collection('users').doc(doctorId));
            
            if (!pDoc.exists) throw new Error('Patient not found');
            if (!dDoc.exists) throw new Error('Doctor not found');

            const doctorData = dDoc.data() || {};
            const patientData = pDoc.data() || {};
            const slotDuration = schedule?.slotDurationMinutes || 20;
            const endTime = computeEndTime(startTime, slotDuration);
            const startAt = `${date}T${startTime}:00`;
            const endAt = `${date}T${endTime}:00`;
            const docSpec = specialization || doctorData.specialization || 'General Practitioner';

            const aptRef = db.collection('appointments').doc();
            const aptData = {
                patientId,
                patientName: patientData.name || 'Unknown Patient',
                patientPhone: patientData.phone || '',
                patientAge: patientData.age || null,
                patientGender: patientData.gender || '',
                doctorId,
                doctorName: doctorData.name || 'Unknown Doctor',
                doctorSpecialization: docSpec,
                doctorRoom: doctorData.room || doctorData.cabin || 'Consultation Room',
                date,
                startTime,
                endTime,
                startAt,
                endAt,
                status: 'BOOKED',
                checkInStatus: 'NOT_ARRIVED',
                priority: priority || 'NORMAL',
                notes: notes || '',
                source,
                createdAt: new Date().toISOString()
            };

            t.set(aptRef, aptData);
            return { id: aptRef.id, ...aptData };
        });

        res.status(201).json(result);
    } catch (e: any) {
        if (e.message === 'Slot is already booked' || e.message.includes('Doctor has reached maximum') || e.message.includes('holiday')) {
            return res.status(409).json({ message: e.message });
        }
        res.status(502).json({ message: e.message });
    }
});

// Update appointment status helper
const updateStatusHandler = async (req: any, res: any) => {
    const { status } = req.body;
    if (!status) return res.status(400).json({ message: 'status is required' });

    const aptRef = db.collection('appointments').doc(req.params.id);
    const aptDoc = await aptRef.get();
    if (!aptDoc.exists) return res.status(404).json({ message: 'Appointment not found' });
    const apt = aptDoc.data()!;

    if (req.profile.role === 'DOCTOR' && apt.doctorId !== req.profile.uid) {
        return res.status(403).json({ message: 'Access denied. You can only update appointments for your own schedule.' });
    }

    const nowIso = new Date().toISOString();
    const updatePayload: any = {
        status,
        updatedAt: nowIso
    };
    if (status === 'COMPLETED') updatePayload.completedAt = nowIso;
    if (status === 'CHECKED_IN') updatePayload.checkInStatus = 'CHECKED_IN';

    await aptRef.update(updatePayload);
    res.json({ id: req.params.id, status });
};

// PUT /api/appointments/:id/status & PATCH /api/appointments/:id/status
router.put('/:id/status', authenticate, authorize(['ADMIN', 'DOCTOR', 'RECEPTIONIST']), updateStatusHandler);
router.patch('/:id/status', authenticate, authorize(['ADMIN', 'DOCTOR', 'RECEPTIONIST']), updateStatusHandler);

// Cancellation helper
const cancelHandler = async (req: any, res: any) => {
    const aptRef = db.collection('appointments').doc(req.params.id);
    const aptDoc = await aptRef.get();
    if (!aptDoc.exists) return res.status(404).json({ message: 'Appointment not found' });
    
    const apt = aptDoc.data()!;
    
    // Check patient ownership
    if (req.profile.role === 'PATIENT' && apt.patientId !== req.profile.patientId) {
        return res.status(403).json({ message: 'Access denied. You can only cancel your own appointments.' });
    }

    // Check doctor ownership
    if (req.profile.role === 'DOCTOR' && apt.doctorId !== req.profile.uid) {
        return res.status(403).json({ message: 'Access denied. You can only cancel appointments for your own schedule.' });
    }
    
    // Check if appointment is eligible for cancellation
    if (apt.status === 'CANCELLED') {
        return res.status(400).json({ message: 'Appointment is already cancelled' });
    }
    if (apt.status === 'COMPLETED') {
        return res.status(400).json({ message: 'Completed appointments cannot be cancelled' });
    }
    
    const today = new Date().toISOString().split('T')[0];
    if (apt.date < today) {
        return res.status(400).json({ message: 'Past appointments cannot be cancelled' });
    }
    
    const nowIso = new Date().toISOString();
    await aptRef.update({
        status: 'CANCELLED',
        cancelledAt: nowIso,
        cancelledBy: req.profile.uid
    });

    if (apt.queueId) {
        await db.collection('queue').doc(apt.queueId).update({
            status: 'CANCELLED',
            cancelledAt: nowIso
        }).catch(() => {});
    }
    
    res.json({ id: req.params.id, status: 'CANCELLED' });
};

// POST & PATCH /api/appointments/:id/cancel
router.post('/:id/cancel', authenticate, cancelHandler);
router.patch('/:id/cancel', authenticate, cancelHandler);

// Check-in helper
const checkinHandler = async (req: any, res: any) => {
    const { id } = req.params;

    try {
        const result = await db.runTransaction(async (t) => {
            const aptRef = db.collection('appointments').doc(id);
            const aptDoc = await t.get(aptRef);
            if (!aptDoc.exists) {
                const err: any = new Error('Appointment not found');
                err.status = 404;
                throw err;
            }

            const apt = aptDoc.data()!;

            // Authorization check
            if (req.profile.role === 'DOCTOR' && apt.doctorId !== req.profile.uid) {
                const err: any = new Error('Access denied. You can only check in patients for your own appointments.');
                err.status = 403;
                throw err;
            }
            if (req.profile.role === 'PATIENT' && apt.patientId !== req.profile.patientId) {
                const err: any = new Error('Access denied. You can only check in for your own appointment.');
                err.status = 403;
                throw err;
            }

            // Status checks
            if (apt.status === 'CHECKED_IN') {
                const err: any = new Error('Appointment is already checked in.');
                err.status = 409;
                throw err;
            }
            if (apt.status === 'COMPLETED') {
                const err: any = new Error('Appointment has already been completed.');
                err.status = 409;
                throw err;
            }
            if (apt.status === 'CANCELLED') {
                const err: any = new Error('Cancelled appointments cannot be checked in.');
                err.status = 409;
                throw err;
            }

            // Allow check-in for any booked or confirmed appointment regardless of whether
            // the appointment was scheduled for today, a past date (missed appointment arriving today),
            // or an upcoming date (early arrival).
            const today = new Date().toISOString().split('T')[0];

            // Verify patient record exists
            const pRef = db.collection('patients').doc(apt.patientId);
            const pDoc = await t.get(pRef);
            if (!pDoc.exists) {
                const err: any = new Error('Associated patient record not found.');
                err.status = 404;
                throw err;
            }
            const patient = pDoc.data()!;

            // Check if queue token already exists for this appointment
            const existingTokensSnap = await t.get(
                db.collection('queue').where('appointmentId', '==', id)
            );
            const hasActiveToken = existingTokensSnap.docs.some(doc => {
                const s = doc.data().status;
                return s === 'WAITING' || s === 'CALLED';
            });
            if (hasActiveToken) {
                const err: any = new Error('A queue token is already active for this appointment.');
                err.status = 409;
                throw err;
            }

            // Fetch doctor details if available to populate room and specialization
            let doctorSpecialization = apt.doctorSpecialization || 'General Physician';
            let doctorRoom = apt.doctorRoom || 'Cabin 101';
            if (apt.doctorId) {
                const dDoc = await t.get(db.collection('users').doc(apt.doctorId));
                if (dDoc.exists) {
                    const dData = dDoc.data()!;
                    doctorSpecialization = dData.specialization || doctorSpecialization;
                    doctorRoom = dData.room || dData.cabin || doctorRoom;
                }
            }

            // Priority determination:
            // 1. EMERGENCY (if explicitly requested)
            // 2. SENIOR (if patient.age >= 60)
            // 3. NORMAL
            let finalPriority = req.body?.priority || 'NORMAL';
            if (finalPriority !== 'EMERGENCY') {
                const age = Number(patient.age);
                if (!isNaN(age) && age >= 60) {
                    finalPriority = 'SENIOR';
                } else {
                    finalPriority = 'NORMAL';
                }
            }

            // Concurrency-safe token numbering for today
            const todayQueueSnap = await t.get(
                db.collection('queue')
                    .where('createdAt', '>=', today)
                    .where('createdAt', '<=', today + 'T23:59:59.999Z')
            );
            const tokenNumber = `T-${todayQueueSnap.size + 1}`;

            const nowIso = new Date().toISOString();

            let checkinNote = '';
            if (apt.date < today) {
                checkinNote = `Appointment was scheduled for past date (${apt.date} ${apt.startTime || ''}) - Patient arrived and checked in today.`;
            } else if (apt.date > today) {
                checkinNote = `Early arrival today for upcoming appointment scheduled on ${apt.date} (${apt.startTime || ''}).`;
            } else {
                checkinNote = apt.notes || '';
            }

            const tokenRef = db.collection('queue').doc();
            const tokenData = {
                tokenNumber,
                patientId: apt.patientId,
                patientName: patient.name || apt.patientName,
                patientPhone: patient.phone || '',
                patientAge: patient.age || null,
                patientGender: patient.gender || '',
                doctorId: apt.doctorId,
                doctorName: apt.doctorName,
                doctorSpecialization,
                doctorRoom,
                appointmentId: id,
                originalAppointmentDate: apt.date,
                originalAppointmentTime: apt.startTime || '',
                priority: finalPriority,
                status: 'WAITING',
                source: 'APPOINTMENT',
                notes: checkinNote,
                createdAt: nowIso
            };

            t.set(tokenRef, tokenData);

            // Update appointment with both status & checkInStatus
            t.update(aptRef, {
                status: 'CHECKED_IN',
                checkInStatus: 'CHECKED_IN',
                queueId: tokenRef.id,
                queueToken: tokenNumber,
                checkedInAt: nowIso,
                actualCheckInDate: today
            });

            return {
                id,
                appointmentId: id,
                queueId: tokenRef.id,
                queueToken: tokenNumber,
                tokenNumber,
                priority: finalPriority,
                status: 'WAITING',
                patientName: patient.name || apt.patientName,
                doctorName: apt.doctorName,
                checkedInAt: nowIso
            };
        });

        res.json(result);
    } catch (err: any) {
        const status = err.status || 500;
        res.status(status).json({ message: err.message || 'Check-in failed' });
    }
};

// POST & PATCH /api/appointments/:id/checkin
router.post('/:id/checkin', authenticate, authorize(['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT']), checkinHandler);
router.patch('/:id/checkin', authenticate, authorize(['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT']), checkinHandler);

// Complete helper
const completeHandler = async (req: any, res: any) => {
    const aptRef = db.collection('appointments').doc(req.params.id);
    const aptDoc = await aptRef.get();
    if (!aptDoc.exists) return res.status(404).json({ message: 'Appointment not found' });
    const apt = aptDoc.data()!;

    if (req.profile.role === 'DOCTOR' && apt.doctorId !== req.profile.uid) {
        return res.status(403).json({ message: 'Access denied. You can only complete your own appointments.' });
    }

    if (apt.status === 'COMPLETED') {
        return res.status(400).json({ message: 'Appointment is already completed.' });
    }
    if (apt.status === 'CANCELLED') {
        return res.status(400).json({ message: 'Cancelled appointments cannot be completed.' });
    }

    const nowIso = new Date().toISOString();
    await aptRef.update({
        status: 'COMPLETED',
        completedAt: nowIso,
        updatedAt: nowIso
    });

    // Also complete the queue token if active
    if (apt.queueId) {
        await db.collection('queue').doc(apt.queueId).update({
            status: 'COMPLETED',
            completedAt: nowIso
        }).catch(() => {});
    }

    res.json({ id: req.params.id, status: 'COMPLETED', completedAt: nowIso });
};

// POST & PATCH /api/appointments/:id/complete
router.post('/:id/complete', authenticate, authorize(['ADMIN', 'DOCTOR', 'RECEPTIONIST']), completeHandler);
router.patch('/:id/complete', authenticate, authorize(['ADMIN', 'DOCTOR', 'RECEPTIONIST']), completeHandler);

export default router;
