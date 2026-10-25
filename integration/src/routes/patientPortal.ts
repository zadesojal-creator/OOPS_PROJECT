import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { db, formatDoc } from '../firebase/admin';
import { CppEngine } from '../cpp-adapter/CppEngine';

const router = Router();

// Helper to mask phone/chatId
function maskString(val: string | number | undefined | null): string {
    if (!val) return '—';
    const str = String(val);
    if (str.length <= 4) return '****';
    return str.slice(0, 2) + '*'.repeat(str.length - 4) + str.slice(-2);
}

// GET /api/patient-portal/dashboard
router.get('/dashboard', authenticate, async (req, res) => {
    let patientId = req.profile.role === 'PATIENT' ? req.profile.patientId : (req.query.patientId as string);

    if (!patientId && req.profile.role === 'PATIENT') {
        // Fallback: search by user email or phone
        if (req.profile.email) {
            const snap = await db.collection('patients').where('email', '==', req.profile.email).limit(1).get();
            if (!snap.empty) patientId = snap.docs[0].id;
        }
    }

    if (!patientId) {
        return res.status(404).json({ message: 'Patient profile not found for this account' });
    }

    const patientDoc = await db.collection('patients').doc(patientId).get();
    if (!patientDoc.exists) {
        return res.status(404).json({ message: 'Patient profile record not found' });
    }

    const patient = formatDoc(patientDoc);
    const today = new Date().toISOString().split('T')[0];

    // 1. Active Queue Token and Live Position
    let activeQueue: any = null;
    const queueSnap = await db.collection('queue')
        .where('patientId', '==', patientId)
        .get();

    const activeTokenDoc = queueSnap.docs
        .map(formatDoc)
        .find(t => (t.createdAt && t.createdAt.startsWith(today)) && (t.status === 'WAITING' || t.status === 'CALLED'));

    if (activeTokenDoc) {
        if (activeTokenDoc.status === 'CALLED') {
            activeQueue = {
                ...activeTokenDoc,
                position: 0,
                aheadCount: 0,
                message: 'Your token has been called! Please proceed to the consultation room.'
            };
        } else {
            // WAITING: Calculate queue position using C++ ordering
            const waitingSnap = await db.collection('queue').where('status', '==', 'WAITING').get();
            const waitingTokens = waitingSnap.docs.map(formatDoc);
            try {
                const result = await CppEngine.execute('orderQueue', { tokens: waitingTokens });
                const ordered = result.ordered || [];
                const index = ordered.findIndex((t: any) => t.id === activeTokenDoc.id);
                activeQueue = {
                    ...activeTokenDoc,
                    position: index >= 0 ? index + 1 : 1,
                    aheadCount: index >= 0 ? index : 0,
                    estimatedWaitMinutes: index >= 0 ? (index + 1) * 15 : 15
                };
            } catch {
                activeQueue = {
                    ...activeTokenDoc,
                    position: 1,
                    aheadCount: 0,
                    estimatedWaitMinutes: 15
                };
            }
        }
    }

    // 2. Appointments (Upcoming & Past)
    const aptSnap = await db.collection('appointments').where('patientId', '==', patientId).get();
    const allAppointments = aptSnap.docs.map(formatDoc);

    // Fetch doctors to attach specialization if needed
    const doctorsSnap = await db.collection('users').where('role', '==', 'DOCTOR').get();
    const docMap = new Map<string, any>();
    doctorsSnap.forEach(d => docMap.set(d.id, d.data()));

    const enrichedAppointments = allAppointments.map(a => {
        const docData = docMap.get(a.doctorId);
        return {
            ...a,
            doctorSpecialization: docData?.specialization || 'General Practitioner',
            doctorRoom: docData?.room || 'Consultation Room'
        };
    }).sort((a, b) => b.date.localeCompare(a.date));

    const upcomingAppointments = enrichedAppointments.filter(
        a => (a.status === 'BOOKED' || a.status === 'CONFIRMED') && a.date >= today
    );
    const pastAppointments = enrichedAppointments.filter(
        a => !upcomingAppointments.some(u => u.id === a.id)
    );

    // 3. Consultations grouped by doctor and date
    const consultSnap = await db.collection('consultations').where('patientId', '==', patientId).get();
    const consultations = consultSnap.docs.map(formatDoc).map(c => {
        const docData = docMap.get(c.doctorId);
        return {
            ...c,
            doctorSpecialization: docData?.specialization || 'General Practitioner',
            date: c.createdAt ? c.createdAt.split('T')[0] : ''
        };
    }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // Grouping helper
    const groupedConsultations: { [doctorName: string]: any[] } = {};
    for (const c of consultations) {
        const key = c.doctorName || 'Doctor';
        if (!groupedConsultations[key]) groupedConsultations[key] = [];
        groupedConsultations[key].push(c);
    }

    // 4. Prescriptions
    const prescripSnap = await db.collection('prescriptions').where('patientId', '==', patientId).get();
    const prescriptions = prescripSnap.docs.map(doc => {
        const p = formatDoc(doc);
        delete p.filePath;
        p.downloadUrl = `/api/prescriptions/${p.id}/pdf`;
        return p;
    }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // 5. Telegram Linking Status & Deliveries
    let telegramLinked = !!patient.telegramLinked;
    let telegramChatId = patient.telegramChatId;
    let telegramLinkedAt = patient.telegramLinkedAt;

    if (!telegramLinked) {
        const linkDoc = await db.collection('telegramLinks').doc(patientId).get();
        if (linkDoc.exists && linkDoc.data()?.verified) {
            telegramLinked = true;
            telegramChatId = linkDoc.data()?.chatId;
            telegramLinkedAt = linkDoc.data()?.linkedAt;
        }
    }

    // Recent Telegram deliveries for this patient
    const deliveryLogsSnap = await db.collection('telegramDeliveryLogs')
        .where('patientId', '==', patientId)
        .limit(10)
        .get();
    const deliveryHistory = deliveryLogsSnap.docs.map(formatDoc).sort(
        (a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')
    );

    res.json({
        patient: {
            id: patient.id,
            name: patient.name,
            phone: patient.phone,
            age: patient.age,
            gender: patient.gender,
            email: patient.email || req.profile.email || ''
        },
        activeQueue,
        upcomingAppointments,
        pastAppointments,
        consultations,
        groupedConsultations,
        prescriptions,
        telegram: {
            isLinked: telegramLinked,
            chatIdMasked: maskString(telegramChatId),
            linkedAt: telegramLinkedAt || null,
            deliveries: deliveryHistory
        }
    });
});

// POST /api/patient-portal/generate-link-code
router.post('/generate-link-code', authenticate, async (req, res) => {
    const patientId = req.profile.role === 'PATIENT' ? req.profile.patientId : (req.body.patientId || req.profile.uid);
    if (!patientId) {
        return res.status(400).json({ message: 'patientId is required' });
    }

    const patientDoc = await db.collection('patients').doc(patientId).get();
    if (!patientDoc.exists) {
        return res.status(404).json({ message: 'Patient not found' });
    }

    // Generate random 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes validity

    await db.collection('telegramLinkCodes').doc(code).set({
        code,
        patientId,
        phone: patientDoc.data()?.phone || '',
        createdAt: new Date().toISOString(),
        expiresAt
    });

    res.json({
        code,
        expiresAt,
        botUsername: 'Clinical_oops_bot',
        instructions: `Open @Clinical_oops_bot on Telegram and type: /link ${code}`
    });
});

// POST /api/patient-portal/cancel-appointment/:id
router.post('/cancel-appointment/:id', authenticate, async (req, res) => {
    const aptRef = db.collection('appointments').doc(req.params.id);
    const aptDoc = await aptRef.get();
    if (!aptDoc.exists) return res.status(404).json({ message: 'Appointment not found' });
    
    const apt = aptDoc.data()!;
    if (req.profile.role === 'PATIENT' && apt.patientId !== req.profile.patientId) {
        return res.status(403).json({ message: 'Access denied. You can only cancel your own appointments.' });
    }
    
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
    
    await aptRef.update({
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
        cancelledBy: req.profile.uid
    });
    
    res.json({ id: req.params.id, status: 'CANCELLED' });
});

// GET /api/patient-portal/family
router.get('/family', authenticate, async (req, res) => {
    try {
        let patientId = req.profile.role === 'PATIENT' ? req.profile.patientId : (req.query.patientId as string);
        if (!patientId && req.profile.email) {
            const snap = await db.collection('patients').where('email', '==', req.profile.email).limit(1).get();
            if (!snap.empty) patientId = snap.docs[0].id;
        }

        if (!patientId) {
            return res.status(404).json({ message: 'Patient profile not found' });
        }

        // 1. Fetch current patient record
        const patientDoc = await db.collection('patients').doc(patientId).get();
        const patientData = patientDoc.exists ? formatDoc(patientDoc) : null;

        // 2. Find chatId from telegramLinks or familyMembers
        let chatId: string | null = null;
        const linkDoc = await db.collection('telegramLinks').doc(patientId).get();
        if (linkDoc.exists && linkDoc.data()?.chatId) {
            chatId = linkDoc.data()?.chatId;
        }

        if (!chatId) {
            const fmSnap = await db.collection('familyMembers').where('patientId', '==', patientId).limit(1).get();
            if (!fmSnap.empty) {
                chatId = fmSnap.docs[0].data()?.chatId;
            }
        }

        // 3. If we have chatId, fetch all family members under this chat
        let familyMembers: any[] = [];
        if (chatId) {
            const membersSnap = await db.collection('familyMembers').where('chatId', '==', String(chatId)).get();
            familyMembers = membersSnap.docs.map(formatDoc);
        }

        // Always include current patient in the list if not already present
        const hasSelf = familyMembers.some(m => m.patientId === patientId);
        if (!hasSelf && patientData) {
            familyMembers.unshift({
                id: patientId,
                patientId,
                name: patientData.name || 'Primary Patient',
                relationship: 'Self',
                phone: patientData.phone,
                age: patientData.age,
                gender: patientData.gender,
                isVerified: true
            });
        }

        res.json({
            primaryPatientId: patientId,
            telegramLinked: !!chatId,
            members: familyMembers
        });
    } catch (e: any) {
        res.status(500).json({ message: e.message || 'Failed to fetch family members' });
    }
});

export default router;
