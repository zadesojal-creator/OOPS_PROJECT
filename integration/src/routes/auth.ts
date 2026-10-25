import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { db, auth } from '../firebase/admin';
import { DoctorSyncService } from '../services/DoctorSyncService';

const router = Router();

// GET /api/me
router.get('/me', authenticate, (req, res) => {
    res.json(req.profile);
});

// POST /api/admin/users
router.post('/admin/users', authenticate, authorize(['ADMIN']), async (req, res) => {
    let { uid, name, email, password, role, active = true, onDuty, patientId, phone, specialization, room, fee } = req.body;
    
    if (!name || !email || !role || typeof active !== 'boolean') {
        return res.status(400).json({ message: 'Provide a name, email, role, and active flag' });
    }

    if (!['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role. Must be ADMIN, DOCTOR, RECEPTIONIST, or PATIENT' });
    }

    // Auto-create or resolve user in Firebase Authentication if UID is not provided
    if (!uid) {
        if (!password || password.length < 6) {
            return res.status(400).json({ message: 'Password is required (minimum 6 characters) to create user account' });
        }

        try {
            let userRecord;
            try {
                userRecord = await auth.getUserByEmail(email);
                // If user already exists in Firebase Auth, update credentials
                await auth.updateUser(userRecord.uid, {
                    password,
                    displayName: name
                });
            } catch (err: any) {
                if (err.code === 'auth/user-not-found') {
                    userRecord = await auth.createUser({
                        email,
                        password,
                        displayName: name
                    });
                } else {
                    throw err;
                }
            }
            uid = userRecord.uid;
        } catch (err: any) {
            console.error('Firebase Auth error during user creation:', err);
            return res.status(400).json({ message: `Failed to create Firebase user: ${err.message}` });
        }
    }

    const userRef = db.collection('users').doc(uid);
    const doc = await userRef.get();
    
    const userData: any = {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        active,
        onDuty: role === 'DOCTOR' ? (onDuty !== undefined ? !!onDuty : true) : false,
        updatedAt: new Date().toISOString()
    };
    if (patientId) userData.patientId = patientId;
    if (phone) userData.phone = phone.trim();
    if (specialization) userData.specialization = specialization.trim();
    if (room) userData.room = room.trim();
    if (fee) userData.fee = fee;

    // If role is DOCTOR, ensure default doctor schedule exists
    if (role === 'DOCTOR') {
        const schedRef = db.collection('doctor_schedules').doc(uid);
        const schedDoc = await schedRef.get();
        if (!schedDoc.exists) {
            await schedRef.set({
                doctorId: uid,
                workingDays: [1, 2, 3, 4, 5, 6],
                startTime: "09:00",
                endTime: "17:00",
                lunchStart: "13:00",
                lunchEnd: "14:00",
                slotDurationMinutes: 20,
                maxAppointments: 20
            });
        }
    }

    if (doc.exists) {
        await userRef.update(userData);
        if (role === 'DOCTOR') {
            await DoctorSyncService.syncDoctorsKnowledgeBase().catch(err => {
                console.error('[auth.ts] Error auto-syncing doctor update to knowledge base:', err);
            });
        }
        res.json({ uid, ...userData, message: 'User updated successfully' });
    } else {
        const newData = { ...userData, createdAt: new Date().toISOString() };
        await userRef.set(newData);
        if (role === 'DOCTOR') {
            await DoctorSyncService.syncDoctorsKnowledgeBase().catch(err => {
                console.error('[auth.ts] Error auto-syncing new doctor to knowledge base:', err);
            });
        }
        res.status(201).json({ uid, ...newData, message: 'User created and role assigned successfully' });
    }
});

// POST /api/me/availability
router.post('/me/availability', authenticate, authorize(['DOCTOR']), async (req, res) => {
    const { onDuty } = req.body;
    if (typeof onDuty !== 'boolean') {
        return res.status(400).json({ message: 'onDuty must be a boolean' });
    }

    await db.collection('users').doc(req.profile.uid).update({
        onDuty,
        updatedAt: new Date().toISOString()
    });

    res.json({ onDuty });
});

export default router;
