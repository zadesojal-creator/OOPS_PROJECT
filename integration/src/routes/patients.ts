import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { db, formatDoc } from '../firebase/admin';
import { FamilyService } from '../telegram/services/FamilyService';

const router = Router();

// GET /api/patients
router.get('/', authenticate, async (req, res) => {
    if (req.profile.role === 'PATIENT') {
        const myPatientId = req.profile.patientId;
        const patientDoc = await db.collection('patients').doc(myPatientId).get();
        if (!patientDoc.exists) return res.json([]);
        const p = formatDoc(patientDoc);
        delete p.notes;
        return res.json([p]);
    }

    const search = (req.query.search as string) || '';
    const loweredSearch = search.toLowerCase();
    
    const snapshot = await db.collection('patients').get();
    const patients: any[] = [];
    
    snapshot.forEach(doc => {
        const patient = formatDoc(doc);
        delete patient.notes; // Hide notes in list view
        
        if (search) {
            const emailMatch = patient.email && patient.email.toLowerCase().includes(loweredSearch);
            if (!patient.name.toLowerCase().includes(loweredSearch) && !patient.phone.includes(search) && !emailMatch) {
                return;
            }
        }
        patients.push(patient);
    });
    
    res.json(patients);
});

function computeEndTime(startTime: string, durationMinutes: number = 20): string {
    const parts = startTime.split(':').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return startTime;
    const totalMins = parts[0] * 60 + parts[1] + durationMinutes;
    const endH = Math.floor(totalMins / 60) % 24;
    const endM = totalMins % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

// POST /api/patients
router.post('/', authenticate, authorize(['ADMIN', 'RECEPTIONIST']), async (req, res) => {
    const {
        name,
        phone,
        email,
        age,
        gender,
        notes,
        visitType, // 'WALK_IN' | 'APPOINTMENT' | 'NONE'
        doctorId,
        specialization,
        priority,
        appointmentDate,
        appointmentTime,
        telegramChatId,
        telegramPhone
    } = req.body;
    
    if (!name || name.length < 2 || name.length > 120) return res.status(400).json({ message: 'Invalid name' });
    if (!phone || !/^\+?[0-9 .()\-]{7,20}$/.test(phone)) return res.status(400).json({ message: 'Invalid phone' });
    if (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
        return res.status(400).json({ message: 'Invalid email address' });
    }
    if (typeof age !== 'number' || age < 0 || age > 130) return res.status(400).json({ message: 'Invalid age' });
    if (!['Female', 'Male', 'Other'].includes(gender)) return res.status(400).json({ message: 'Invalid gender' });

    // Validate consulting doctor if visitType is WALK_IN or APPOINTMENT
    let doctorData: any = null;
    if (visitType === 'WALK_IN' || visitType === 'APPOINTMENT') {
        if (!doctorId) {
            return res.status(400).json({ message: 'Consulting doctor is required for visit intake.' });
        }
        const dDoc = await db.collection('users').doc(doctorId).get();
        if (!dDoc.exists) {
            return res.status(400).json({ message: 'Selected consulting doctor does not exist.' });
        }
        doctorData = dDoc.data()!;
        if (doctorData.role !== 'DOCTOR' || doctorData.active === false) {
            return res.status(400).json({ message: 'Selected consulting doctor is not eligible or active.' });
        }
    }

    const patientRef = db.collection('patients').doc();
    const patientId = patientRef.id;

    // Check if phone or telegram identifier can be linked to an existing Telegram chat
    let resolvedChatId: string | null = null;
    const tgIdentifier = (telegramChatId || telegramPhone || phone || '').trim();
    if (tgIdentifier) {
        resolvedChatId = await FamilyService.resolveChatId(tgIdentifier, patientId);
    }

    const patientData: any = {
        name: name.trim(),
        phone: phone.trim(),
        email: email ? email.trim().toLowerCase() : '',
        age,
        gender,
        notes: notes ? notes.trim() : '',
        createdAt: new Date().toISOString()
    };

    if (telegramChatId) patientData.telegramChatIdProvided = telegramChatId.trim();
    if (telegramPhone) patientData.telegramPhone = telegramPhone.trim();

    if (resolvedChatId) {
        patientData.telegramChatId = resolvedChatId;
        patientData.telegramLinked = true;
        patientData.telegramLinkedAt = new Date().toISOString();
    }
    
    await patientRef.set(patientData);

    // WORKFLOW A: WALK-IN PATIENT
    if (visitType === 'WALK_IN') {
        const today = new Date().toISOString().split('T')[0];
        let finalPriority = priority || 'NORMAL';
        if (age >= 60 && finalPriority !== 'EMERGENCY') {
            finalPriority = 'SENIOR';
        }

        const todayQueueSnap = await db.collection('queue')
            .where('createdAt', '>=', today)
            .where('createdAt', '<=', today + 'T23:59:59.999Z')
            .get();
        const tokenNumber = `T-${todayQueueSnap.size + 1}`;
        const nowIso = new Date().toISOString();

        const tokenRef = db.collection('queue').doc();
        const tokenData = {
            patientId,
            patientName: patientData.name,
            patientPhone: patientData.phone,
            patientEmail: patientData.email || '',
            patientAge: patientData.age,
            patientGender: patientData.gender,
            doctorId,
            doctorName: doctorData.name || 'Doctor',
            doctorSpecialization: doctorData.specialization || specialization || 'General Physician',
            doctorRoom: doctorData.room || doctorData.cabin || 'Cabin 101',
            tokenNumber,
            priority: finalPriority,
            status: 'WAITING',
            source: 'RECEPTION_WALK_IN',
            notes: notes ? notes.trim() : '',
            createdAt: nowIso
        };

        await tokenRef.set(tokenData);

        // Queue position calculation
        let position = todayQueueSnap.size + 1;
        let aheadCount = todayQueueSnap.size;
        let estimatedWaitMinutes = position * 15;
        try {
            const waitingSnap = await db.collection('queue').where('status', '==', 'WAITING').get();
            const waitingTokens = waitingSnap.docs.map(formatDoc);
            const { CppEngine } = require('../cpp-adapter/CppEngine');
            const result = await CppEngine.execute('orderQueue', { tokens: waitingTokens });
            const ordered = result.ordered || [];
            const index = ordered.findIndex((t: any) => t.id === tokenRef.id);
            if (index >= 0) {
                position = index + 1;
                aheadCount = index;
                estimatedWaitMinutes = (index + 1) * 15;
            }
        } catch {}

        return res.status(201).json({
            id: patientId,
            ...patientData,
            walkInToken: {
                id: tokenRef.id,
                ...tokenData,
                position,
                aheadCount,
                estimatedWaitMinutes
            }
        });
    }

    // WORKFLOW B: SCHEDULED APPOINTMENT
    if (visitType === 'APPOINTMENT') {
        if (!appointmentDate || !appointmentTime) {
            return res.status(400).json({ message: 'appointmentDate and appointmentTime are required for appointment booking.' });
        }

        try {
            const { CppEngine } = require('../cpp-adapter/CppEngine');
            const aptResult = await db.runTransaction(async (t) => {
                const schedDoc = await t.get(db.collection('doctor_schedules').doc(doctorId));
                const holDocs = await t.get(db.collection('doctor_holidays').where('doctorId', '==', doctorId).where('date', '==', appointmentDate));
                const aptDocs = await t.get(db.collection('appointments').where('doctorId', '==', doctorId).where('date', '==', appointmentDate));

                const schedule = schedDoc.exists ? schedDoc.data() : { maxAppointments: 20, slotDurationMinutes: 20 };
                const holidays = holDocs.docs.map(d => d.data());
                
                const bookedSlots: string[] = [];
                aptDocs.forEach(d => {
                    const a = d.data();
                    if (a.status !== 'CANCELLED') bookedSlots.push(a.startTime);
                });

                // Validate via C++ engine
                await CppEngine.execute('validateAppointment', {
                    maxAppointments: schedule?.maxAppointments,
                    holidays,
                    bookedSlots,
                    date: appointmentDate,
                    time: appointmentTime
                });

                const slotDuration = schedule?.slotDurationMinutes || 20;
                const endTime = computeEndTime(appointmentTime, slotDuration);
                const startAt = `${appointmentDate}T${appointmentTime}:00`;
                const endAt = `${appointmentDate}T${endTime}:00`;
                const docSpec = doctorData.specialization || specialization || 'General Physician';

                const aptRef = db.collection('appointments').doc();
                const aptData = {
                    patientId,
                    patientName: patientData.name,
                    patientPhone: patientData.phone,
                    patientEmail: patientData.email || '',
                    patientAge: patientData.age,
                    patientGender: patientData.gender,
                    doctorId,
                    doctorName: doctorData.name || 'Doctor',
                    doctorSpecialization: docSpec,
                    doctorRoom: doctorData.room || doctorData.cabin || 'Cabin 101',
                    date: appointmentDate,
                    startTime: appointmentTime,
                    endTime,
                    startAt,
                    endAt,
                    status: 'BOOKED',
                    checkInStatus: 'NOT_ARRIVED',
                    priority: priority || 'NORMAL',
                    notes: notes ? notes.trim() : '',
                    source: 'RECEPTION_BOOKING',
                    createdAt: new Date().toISOString()
                };

                t.set(aptRef, aptData);
                return { id: aptRef.id, ...aptData };
            });

            return res.status(201).json({
                id: patientId,
                ...patientData,
                appointment: aptResult
            });
        } catch (e: any) {
            // Delete patient if appointment creation failed to avoid inconsistent orphan records
            await patientRef.delete().catch(() => {});
            if (e.message === 'Slot is already booked' || e.message.includes('Doctor has reached maximum') || e.message.includes('holiday')) {
                return res.status(409).json({ message: e.message });
            }
            return res.status(502).json({ message: e.message || 'Appointment booking failed.' });
        }
    }

    // Default: Simple Patient Registration
    res.status(201).json({ id: patientId, ...patientData });
});

// GET /api/patients/:id
router.get('/:id', authenticate, async (req, res) => {
    // Ownership check for patients
    if (req.profile.role === 'PATIENT' && req.profile.patientId !== req.params.id) {
        return res.status(403).json({ message: 'Access denied. You can only view your own patient record.' });
    }

    const patientDoc = await db.collection('patients').doc(req.params.id).get();
    if (!patientDoc.exists) return res.status(404).json({ message: 'Patient not found' });
    
    const patient = formatDoc(patientDoc);
    
    if (req.profile.role === 'RECEPTIONIST') {
        delete patient.notes;
    }
    
    if (['ADMIN', 'DOCTOR', 'PATIENT'].includes(req.profile.role)) {
        // Fetch consultations
        const cSnapshot = await db.collection('consultations').where('patientId', '==', req.params.id).get();
        patient.consultations = cSnapshot.docs.map(formatDoc);
        
        // Fetch prescriptions
        const pSnapshot = await db.collection('prescriptions').where('patientId', '==', req.params.id).get();
        patient.prescriptions = pSnapshot.docs.map(doc => {
            const p = formatDoc(doc);
            delete p.filePath;
            p.downloadUrl = `/api/prescriptions/${p.id}/pdf`;
            return p;
        });
    }
    
    res.json(patient);
});

// PATCH /api/patients/:id (Update patient details, e.g. email or phone)
router.patch('/:id', authenticate, authorize(['ADMIN', 'RECEPTIONIST', 'DOCTOR']), async (req, res) => {
    const pRef = db.collection('patients').doc(req.params.id);
    const pDoc = await pRef.get();
    if (!pDoc.exists) return res.status(404).json({ message: 'Patient not found' });

    const allowedUpdates: any = {};
    const { email, phone, notes } = req.body;

    if (email !== undefined) {
        if (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
            return res.status(400).json({ message: 'Invalid email address' });
        }
        allowedUpdates.email = email ? email.trim().toLowerCase() : '';
    }

    if (phone !== undefined) {
        if (phone && !/^\+?[0-9 .()\-]{7,20}$/.test(phone)) {
            return res.status(400).json({ message: 'Invalid phone number' });
        }
        allowedUpdates.phone = phone.trim();
    }

    if (notes !== undefined) {
        allowedUpdates.notes = typeof notes === 'string' ? notes.trim() : '';
    }

    allowedUpdates.updatedAt = new Date().toISOString();
    await pRef.update(allowedUpdates);

    const updatedDoc = await pRef.get();
    res.json(formatDoc(updatedDoc));
});

export default router;
