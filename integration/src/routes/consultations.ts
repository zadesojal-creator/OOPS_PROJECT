import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { db, formatDoc } from '../firebase/admin';

const router = Router();

// GET /api/consultations
router.get('/', authenticate, authorize(['ADMIN', 'DOCTOR', 'PATIENT']), async (req, res) => {
    const { patientId, queueId, doctorId } = req.query;

    // Enforce patient ownership
    if (req.profile.role === 'PATIENT') {
        const myPatientId = req.profile.patientId;
        if (patientId && patientId !== myPatientId) {
            return res.status(403).json({ message: 'Patients can only view their own consultations' });
        }
        const snapshot = await db.collection('consultations').where('patientId', '==', myPatientId).get();
        return res.json(snapshot.docs.map(formatDoc));
    }
    
    let query: FirebaseFirestore.Query = db.collection('consultations');
    if (patientId) query = query.where('patientId', '==', patientId as string);
    if (queueId) query = query.where('queueId', '==', queueId as string);
    if (doctorId) query = query.where('doctorId', '==', doctorId as string);
    
    const snapshot = await query.get();
    const consultations = snapshot.docs.map(formatDoc);
    
    res.json(consultations);
});

// POST /api/consultations
router.post('/', authenticate, authorize(['DOCTOR']), async (req, res) => {
    const { queueId, appointmentId, diagnosis, notes, patientId: reqPatientId } = req.body;
    
    if (!diagnosis || (!queueId && !appointmentId && !reqPatientId)) {
        return res.status(400).json({ message: 'diagnosis and either queueId, appointmentId, or patientId are required' });
    }

    let finalPatientId = reqPatientId;
    let finalPatientName = '';
    let finalAppointmentId = appointmentId || null;
    let qDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    let aptDoc: FirebaseFirestore.DocumentSnapshot | null = null;
    
    if (queueId) {
        qDoc = await db.collection('queue').doc(queueId).get();
        if (!qDoc.exists) return res.status(404).json({ message: 'Queue token not found' });
        
        const token = qDoc.data();
        if (token?.status !== 'CALLED') {
            return res.status(409).json({ message: 'Only a CALLED token can be completed' });
        }
        finalPatientId = token.patientId;
        finalPatientName = token.patientName;
        if (!finalAppointmentId && token.appointmentId) {
            finalAppointmentId = token.appointmentId;
        }
    }

    if (finalAppointmentId) {
        aptDoc = await db.collection('appointments').doc(finalAppointmentId).get();
        if (aptDoc.exists) {
            const aptData = aptDoc.data();
            if (!finalPatientId) finalPatientId = aptData?.patientId;
            if (!finalPatientName) finalPatientName = aptData?.patientName;
        }
    }

    if (finalPatientId && !finalPatientName) {
        const pDoc = await db.collection('patients').doc(finalPatientId).get();
        if (pDoc.exists) {
            finalPatientName = pDoc.data()?.name || 'Patient';
        }
    }
    
    const cRef = db.collection('consultations').doc();
    const cData = {
        queueId: queueId || null,
        appointmentId: finalAppointmentId,
        patientId: finalPatientId,
        patientName: finalPatientName,
        doctorId: req.profile.uid,
        doctorName: req.profile.name,
        diagnosis,
        notes: notes || '',
        createdAt: new Date().toISOString()
    };
    
    const batch = db.batch();
    batch.set(cRef, cData);
    if (qDoc && qDoc.exists) {
        batch.update(qDoc.ref, { status: 'COMPLETED' });
    }
    if (aptDoc && aptDoc.exists) {
        batch.update(aptDoc.ref, { status: 'COMPLETED' });
    }
    await batch.commit();
    
    res.status(201).json({ id: cRef.id, ...cData });
});

export default router;
