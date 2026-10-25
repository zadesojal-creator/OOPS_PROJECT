import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { db, formatDoc } from '../firebase/admin';
import { CppEngine } from '../cpp-adapter/CppEngine';
import axios from 'axios';

const router = Router();

// Helper to notify via Telegram
async function notifyTelegram(patientId: string, message: string) {
    try {
        const pDoc = await db.collection('patients').doc(patientId).get();
        if (pDoc.exists) {
            const phone = pDoc.data()?.phone;
            if (phone) {
                // Post to our local Telegram webhook so it can route it if a session exists
                // Note: The C++ version did this via telegramBot_.notifyPatient
                // The Node.js version will handle this via the telegram bot service when implemented
            }
        }
    } catch (e) {
        console.error('Failed to notify telegram', e);
    }
}

// GET /api/queue
router.get('/', authenticate, async (req, res) => {
    const statusFilter = req.query.status as string;
    const snapshot = await db.collection('queue').get();
    
    let tokens: any[] = [];
    snapshot.forEach(doc => {
        const t = formatDoc(doc);
        if (!statusFilter || t.status === statusFilter) {
            tokens.push(t);
        }
    });
    
    // Sort via C++ Engine
    try {
        const result = await CppEngine.execute('orderQueue', { tokens });
        res.json(result.ordered);
    } catch (e: any) {
        res.status(502).json({ message: e.message });
    }
});

// POST /api/queue
router.post('/', authenticate, authorize(['ADMIN', 'RECEPTIONIST']), async (req, res) => {
    const { patientId, doctorId, priority, notes } = req.body;
    
    if (!patientId) {
        return res.status(400).json({ message: 'patientId is required' });
    }

    const pDoc = await db.collection('patients').doc(patientId).get();
    if (!pDoc.exists) return res.status(404).json({ message: 'Patient not found' });
    const patient = pDoc.data()!;

    // Validate consulting doctor eligibility
    if (!doctorId) {
        return res.status(400).json({ message: 'Consulting doctor is required for intake queue entry.' });
    }

    const dDoc = await db.collection('users').doc(doctorId).get();
    if (!dDoc.exists) {
        return res.status(400).json({ message: 'Selected consulting doctor does not exist.' });
    }
    const doctorData = dDoc.data()!;
    if (doctorData.role !== 'DOCTOR' || doctorData.active === false) {
        return res.status(400).json({ message: 'Selected consulting doctor is not eligible or active.' });
    }

    const today = new Date().toISOString().split('T')[0];

    // Duplicate check: Prevent duplicate waiting queue entry for same patient & doctor today
    const existingSnap = await db.collection('queue')
        .where('patientId', '==', patientId)
        .get();

    const hasActiveToken = existingSnap.docs.some(doc => {
        const d = doc.data();
        const isToday = d.createdAt && d.createdAt.startsWith(today);
        return isToday && (d.status === 'WAITING' || d.status === 'CALLED') && (d.doctorId === doctorId || !d.doctorId);
    });

    if (hasActiveToken) {
        return res.status(409).json({ message: 'Patient already has an active queue token for this doctor today.' });
    }

    let finalPriority = priority || 'NORMAL';
    if (patient.age >= 60 && finalPriority !== 'EMERGENCY') {
        finalPriority = 'SENIOR';
    }

    const queueQuery = await db.collection('queue')
        .where('createdAt', '>=', today)
        .where('createdAt', '<=', today + 'T23:59:59.999Z')
        .get();
        
    const tokenNumber = `T-${queueQuery.size + 1}`;
    const nowIso = new Date().toISOString();
    
    const tokenRef = db.collection('queue').doc();
    const tokenData = {
        patientId,
        patientName: patient.name,
        patientPhone: patient.phone || '',
        patientAge: patient.age || null,
        patientGender: patient.gender || '',
        doctorId,
        doctorName: doctorData.name || 'Doctor',
        doctorSpecialization: doctorData.specialization || 'General Physician',
        doctorRoom: doctorData.room || doctorData.cabin || 'Cabin 101',
        tokenNumber,
        priority: finalPriority,
        status: 'WAITING',
        source: 'WALK_IN',
        notes: notes || '',
        createdAt: nowIso
    };
    
    await tokenRef.set(tokenData);

    // Calculate queue position using C++ ordering
    let position = 1;
    let aheadCount = 0;
    let estimatedWaitMinutes = 15;
    try {
        const waitingSnap = await db.collection('queue')
            .where('status', '==', 'WAITING')
            .get();
        const waitingTokens = waitingSnap.docs.map(formatDoc);
        const result = await CppEngine.execute('orderQueue', { tokens: waitingTokens });
        const ordered = result.ordered || [];
        const index = ordered.findIndex((t: any) => t.id === tokenRef.id);
        if (index >= 0) {
            position = index + 1;
            aheadCount = index;
            estimatedWaitMinutes = (index + 1) * 15;
        }
    } catch {
        position = queueQuery.size + 1;
    }

    res.status(201).json({
        id: tokenRef.id,
        ...tokenData,
        position,
        aheadCount,
        estimatedWaitMinutes
    });
});

// GET /api/queue/my-token
router.get('/my-token', authenticate, async (req, res) => {
    const patientId = req.profile.role === 'PATIENT' ? req.profile.patientId : (req.query.patientId as string);
    if (!patientId) {
        return res.status(400).json({ message: 'patientId is required' });
    }

    const today = new Date().toISOString().split('T')[0];
    const snap = await db.collection('queue')
        .where('patientId', '==', patientId)
        .get();

    const activeTokenDoc = snap.docs
        .map(formatDoc)
        .find(t => (t.createdAt && t.createdAt.startsWith(today)) && (t.status === 'WAITING' || t.status === 'CALLED'));

    if (!activeTokenDoc) {
        return res.json({ token: null });
    }

    if (activeTokenDoc.status === 'CALLED') {
        return res.json({
            token: activeTokenDoc,
            status: 'CALLED',
            position: 0,
            aheadCount: 0,
            message: 'Your token has been called! Please proceed to the consultation room.'
        });
    }

    // WAITING: Calculate queue position using C++ ordering
    const waitingSnap = await db.collection('queue').where('status', '==', 'WAITING').get();
    const waitingTokens = waitingSnap.docs.map(formatDoc);

    try {
        const result = await CppEngine.execute('orderQueue', { tokens: waitingTokens });
        const ordered = result.ordered || [];
        const index = ordered.findIndex((t: any) => t.id === activeTokenDoc.id);

        res.json({
            token: activeTokenDoc,
            status: 'WAITING',
            position: index >= 0 ? index + 1 : 1,
            aheadCount: index >= 0 ? index : 0,
            estimatedWaitMinutes: index >= 0 ? (index + 1) * 15 : 15
        });
    } catch {
        res.json({
            token: activeTokenDoc,
            status: 'WAITING',
            position: 1,
            aheadCount: 0,
            estimatedWaitMinutes: 15
        });
    }
});

// POST /api/queue/call-next (Call the next highest priority waiting patient for this doctor)
router.post('/call-next', authenticate, authorize(['DOCTOR', 'RECEPTIONIST', 'ADMIN']), async (req, res) => {
    try {
        const snapshot = await db.collection('queue').where('status', '==', 'WAITING').get();
        let waitingTokens = snapshot.docs.map(formatDoc);

        // If DOCTOR, prioritize tokens assigned to this doctor or unassigned
        if (req.profile.role === 'DOCTOR') {
            const myTokens = waitingTokens.filter(t => t.doctorId === req.profile.uid || !t.doctorId);
            if (myTokens.length > 0) {
                waitingTokens = myTokens;
            }
        }

        if (waitingTokens.length === 0) {
            return res.status(404).json({ message: 'No waiting patients in queue.' });
        }

        const result = await CppEngine.execute('orderQueue', { tokens: waitingTokens });
        const ordered = result.ordered || [];
        if (ordered.length === 0) {
            return res.status(404).json({ message: 'No waiting patients in queue.' });
        }

        const nextToken = ordered[0];
        const nowIso = new Date().toISOString();

        const updateData: any = {
            status: 'CALLED',
            calledAt: nowIso,
            calledBy: req.profile.uid
        };

        // If unassigned token is called by doctor, assign to doctor
        if (!nextToken.doctorId && req.profile.role === 'DOCTOR') {
            updateData.doctorId = req.profile.uid;
            updateData.doctorName = req.profile.name || 'Doctor';
        }

        await db.collection('queue').doc(nextToken.id).update(updateData);

        if (nextToken.appointmentId) {
            await db.collection('appointments').doc(nextToken.appointmentId).update({
                status: 'CHECKED_IN',
                calledAt: nowIso
            }).catch(() => {});
        }

        await notifyTelegram(nextToken.patientId, `Your token ${nextToken.tokenNumber} is being called. Please proceed to the clinic.`);

        res.json({ id: nextToken.id, status: 'CALLED', token: { ...nextToken, ...updateData } });
    } catch (e: any) {
        res.status(502).json({ message: e.message });
    }
});

// POST /api/queue/:id/call (Call a specific patient from the queue)
router.post('/:id/call', authenticate, authorize(['DOCTOR', 'RECEPTIONIST', 'ADMIN']), async (req, res) => {
    const { id } = req.params;
    
    const tDoc = await db.collection('queue').doc(id).get();
    if (!tDoc.exists) return res.status(404).json({ message: 'Token not found' });
    const tData = tDoc.data()!;
    if (tData.status !== 'WAITING') return res.status(409).json({ message: 'Only waiting tokens can be called' });
    
    try {
        const nowIso = new Date().toISOString();
        const updateData: any = {
            status: 'CALLED',
            calledAt: nowIso,
            calledBy: req.profile.uid
        };

        // If unassigned token is called by doctor, assign to calling doctor
        if (!tData.doctorId && req.profile.role === 'DOCTOR') {
            updateData.doctorId = req.profile.uid;
            updateData.doctorName = req.profile.name || 'Doctor';
        }
        
        await db.collection('queue').doc(id).update(updateData);
        
        if (tData.appointmentId) {
            await db.collection('appointments').doc(tData.appointmentId).update({
                status: 'CHECKED_IN',
                calledAt: nowIso
            }).catch(() => {});
        }
        
        const tokenNumber = tData.tokenNumber;
        await notifyTelegram(tData.patientId, `Your token ${tokenNumber} is being called. Please proceed to the clinic.`);
        
        res.json({ id, status: 'CALLED', token: { id, ...tData, ...updateData } });
    } catch (e: any) {
        res.status(502).json({ message: e.message });
    }
});

// PATCH /api/queue/:id/cancel
router.patch('/:id/cancel', authenticate, authorize(['ADMIN', 'RECEPTIONIST']), async (req, res) => {
    const { id } = req.params;
    const tDoc = await db.collection('queue').doc(id).get();
    if (!tDoc.exists) return res.status(404).json({ message: 'Token not found' });
    
    await db.collection('queue').doc(id).update({
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
        cancelledBy: req.profile.uid
    });
    
    res.json({ id, status: 'CANCELLED' });
});

export default router;
