import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { db, formatDoc } from '../firebase/admin';
import { CppEngine } from '../cpp-adapter/CppEngine';

const router = Router();

// GET /api/dashboard/stats
router.get('/stats', authenticate, async (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    const [queueSnapshot, usersSnapshot, aptSnapshot] = await Promise.all([
        db.collection('queue').get(),
        db.collection('users').get(),
        db.collection('appointments').get()
    ]);

    let waiting = 0;
    let completed = 0;
    let emergency = 0;
    let senior = 0;
    let doctorsAvailable = 0;

    queueSnapshot.forEach(doc => {
        const item = formatDoc(doc);
        if (item.createdAt && item.createdAt.startsWith(today)) {
            if (item.status === 'WAITING') {
                waiting++;
                if (item.priority === 'EMERGENCY') emergency++;
                if (item.priority === 'SENIOR') senior++;
            } else if (item.status === 'COMPLETED') {
                completed++;
            }
        }
    });

    usersSnapshot.forEach(doc => {
        const user = formatDoc(doc);
        if (user.role === 'DOCTOR' && user.active && user.onDuty) {
            doctorsAvailable++;
        }
    });

    const response: any = {
        waiting,
        completed,
        emergency,
        senior,
        doctorsAvailable
    };

    // If caller is DOCTOR, attach their personalized statistics
    if (req.profile.role === 'DOCTOR') {
        const doctorId = req.profile.uid;
        let doctorTodayApts = 0;
        aptSnapshot.forEach(doc => {
            const a = doc.data();
            if (a.doctorId === doctorId && a.date === today && a.status !== 'CANCELLED') {
                doctorTodayApts++;
            }
        });
        response.myAppointmentsToday = doctorTodayApts;
        response.onDuty = !!req.profile.onDuty;
    }

    res.json(response);
});

// GET /api/dashboard/doctor-wise (ADMIN ONLY)
router.get('/doctor-wise', authenticate, authorize(['ADMIN']), async (req, res) => {
    const today = new Date().toISOString().split('T')[0];

    const [doctorsSnap, schedulesSnap, aptsSnap, consultsSnap, patientsSnap] = await Promise.all([
        db.collection('users').where('role', '==', 'DOCTOR').where('active', '==', true).get(),
        db.collection('doctor_schedules').get(),
        db.collection('appointments').get(),
        db.collection('consultations').get(),
        db.collection('patients').get()
    ]);

    const schedulesMap = new Map<string, any>();
    schedulesSnap.forEach(s => schedulesMap.set(s.id, s.data()));

    const patientsMap = new Map<string, any>();
    patientsSnap.forEach(p => patientsMap.set(p.id, formatDoc(p)));

    const allApts = aptsSnap.docs.map(formatDoc);
    const allConsults = consultsSnap.docs.map(formatDoc);

    const doctorsData = doctorsSnap.docs.map(doc => {
        const d = formatDoc(doc);
        const doctorId = d.uid || d.id;
        const schedule = schedulesMap.get(doctorId) || {
            workingDays: [1, 2, 3, 4, 5, 6],
            startTime: "09:00", endTime: "17:00",
            lunchStart: "13:00", lunchEnd: "14:00",
            slotDurationMinutes: 20, maxAppointments: 20
        };

        const docApts = allApts.filter(a => a.doctorId === doctorId);
        const docConsults = allConsults.filter(c => c.doctorId === doctorId);

        // Calculate unique patients vs total visits mathematically
        const patientVisitsMap = new Map<string, { visitsCount: number, lastVisitDate: string, recentStatus: string }>();

        docApts.forEach(a => {
            if (!a.patientId) return;
            const existing = patientVisitsMap.get(a.patientId) || { visitsCount: 0, lastVisitDate: a.date || '', recentStatus: a.status };
            existing.visitsCount += 1;
            if (a.date && a.date > existing.lastVisitDate) {
                existing.lastVisitDate = a.date;
                existing.recentStatus = a.status;
            }
            patientVisitsMap.set(a.patientId, existing);
        });

        docConsults.forEach(c => {
            if (!c.patientId) return;
            const cDate = c.createdAt ? c.createdAt.split('T')[0] : '';
            const existing = patientVisitsMap.get(c.patientId) || { visitsCount: 0, lastVisitDate: cDate, recentStatus: 'COMPLETED' };
            const hasExistingApt = c.appointmentId && docApts.some(a => a.id === c.appointmentId);
            if (!hasExistingApt) {
                existing.visitsCount += 1;
            }
            if (existing.visitsCount < 1) existing.visitsCount = 1;
            if (cDate && cDate > existing.lastVisitDate) {
                existing.lastVisitDate = cDate;
            }
            patientVisitsMap.set(c.patientId, existing);
        });

        const uniquePatientsCount = patientVisitsMap.size;
        let totalVisitsCount = 0;
        patientVisitsMap.forEach(v => {
            if (v.visitsCount < 1) v.visitsCount = 1;
            totalVisitsCount += v.visitsCount;
        });
        if (totalVisitsCount < uniquePatientsCount) {
            totalVisitsCount = uniquePatientsCount;
        }

        // Today's counts
        const todayApts = docApts.filter(a => a.date === today);
        let waitingCount = 0;
        let inConsultationCount = 0;
        let completedCount = 0;
        let cancelledCount = 0;

        docApts.forEach(a => {
            if (a.status === 'CANCELLED') cancelledCount++;
            else if (a.status === 'COMPLETED') completedCount++;
            else if (a.status === 'BOOKED' || a.status === 'CONFIRMED') {
                if (a.date === today) waitingCount++;
            }
        });

        // Associated patients list with details
        const associatedPatients = Array.from(patientVisitsMap.entries()).map(([pid, stats]) => {
            const pInfo = patientsMap.get(pid) || {};
            return {
                id: pid,
                name: pInfo.name || 'Unknown Patient',
                phone: pInfo.phone || '—',
                age: pInfo.age || 0,
                gender: pInfo.gender || '—',
                totalVisits: stats.visitsCount,
                lastVisitDate: stats.lastVisitDate,
                recentStatus: stats.recentStatus
            };
        }).sort((a, b) => b.lastVisitDate.localeCompare(a.lastVisitDate));

        // Recent consultations (up to 10)
        const recentConsultations = docConsults
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
            .slice(0, 10);

        return {
            id: doctorId,
            name: d.name,
            email: d.email,
            specialization: d.specialization || 'General Physician',
            room: d.room || 'Cabin 101',
            fee: d.fee || '$35',
            onDuty: !!d.onDuty,
            schedule,
            metrics: {
                uniquePatientsCount,
                totalVisitsCount,
                todayAppointmentsCount: todayApts.length,
                waitingCount,
                inConsultationCount,
                completedCount,
                cancelledCount
            },
            patients: associatedPatients,
            recentConsultations
        };
    });

    res.json({ doctors: doctorsData });
});

// GET /api/dashboard/doctor-summary (DOCTOR ONLY)
router.get('/doctor-summary', authenticate, authorize(['DOCTOR']), async (req, res) => {
    const doctorId = req.profile.uid;
    const today = new Date().toISOString().split('T')[0];

    // Verify doctor profile exists in users collection
    const userDoc = await db.collection('users').doc(doctorId).get();
    if (!userDoc.exists) {
        return res.status(404).json({ message: 'Doctor profile configuration error: Profile record missing for this account.' });
    }
    const docData = formatDoc(userDoc);
    if (docData.role !== 'DOCTOR' || docData.active === false) {
        return res.status(403).json({ message: 'Doctor profile configuration error: Account is not configured with an active DOCTOR role.' });
    }

    const [queueSnap, aptsSnap, consultsSnap, patientsSnap, schedDoc] = await Promise.all([
        db.collection('queue').get(),
        db.collection('appointments').where('doctorId', '==', doctorId).get(),
        db.collection('consultations').where('doctorId', '==', doctorId).get(),
        db.collection('patients').get(),
        db.collection('doctor_schedules').doc(doctorId).get()
    ]);

    const patientsMap = new Map<string, any>();
    patientsSnap.forEach(p => patientsMap.set(p.id, formatDoc(p)));

    // 1. Appointments for today
    const doctorApts = aptsSnap.docs.map(formatDoc);
    const todayAppointments = doctorApts
        .filter(a => a.date === today)
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    // 2. Queue tokens for today (filtered specifically to this doctor or general queue)
    const queueTokens = queueSnap.docs.map(formatDoc).filter(t => t.createdAt && t.createdAt.startsWith(today));
    let waitingTokens = queueTokens.filter(t => t.status === 'WAITING' && (!t.doctorId || t.doctorId === doctorId));
    
    // Sort waiting tokens using C++ Priority Engine (Emergency -> Senior -> Normal)
    try {
        const orderResult = await CppEngine.execute('orderQueue', { tokens: waitingTokens });
        if (orderResult.ordered && Array.isArray(orderResult.ordered)) {
            waitingTokens = orderResult.ordered;
        }
    } catch {
        const priorityScore: Record<string, number> = { EMERGENCY: 3, SENIOR: 2, NORMAL: 1 };
        waitingTokens.sort((a, b) => {
            const pDiff = (priorityScore[b.priority || 'NORMAL'] || 1) - (priorityScore[a.priority || 'NORMAL'] || 1);
            if (pDiff !== 0) return pDiff;
            return (a.createdAt || '').localeCompare(b.createdAt || '');
        });
    }
    const calledToken = queueTokens.find(t => t.status === 'CALLED' && (t.calledBy === doctorId || t.doctorId === doctorId));
    const completedQueueToday = queueTokens.filter(t => t.status === 'COMPLETED' && (t.doctorId === doctorId || t.calledBy === doctorId));

    const doctorConsults = consultsSnap.docs.map(formatDoc);
    const consultsToday = doctorConsults.filter(c => c.createdAt && c.createdAt.startsWith(today));
    const completedConsultationsCount = Math.max(completedQueueToday.length, consultsToday.length);

    const emergencyCount = waitingTokens.filter(t => t.priority === 'EMERGENCY').length;
    const seniorCount = waitingTokens.filter(t => t.priority === 'SENIOR').length;

    // 3. Patients associated with this doctor
    const patientVisitsMap = new Map<string, { count: number, lastVisit: string }>();
    doctorApts.forEach(a => {
        if (!a.patientId) return;
        const e = patientVisitsMap.get(a.patientId) || { count: 0, lastVisit: a.date };
        e.count++;
        if (a.date > e.lastVisit) e.lastVisit = a.date;
        patientVisitsMap.set(a.patientId, e);
    });

    const myPatients = Array.from(patientVisitsMap.entries()).map(([pid, v]) => {
        const p = patientsMap.get(pid) || {};
        return {
            id: pid,
            name: p.name || 'Patient',
            phone: p.phone || '',
            age: p.age || 0,
            gender: p.gender || '',
            visitsCount: v.count,
            lastVisit: v.lastVisit
        };
    }).sort((a, b) => b.lastVisit.localeCompare(a.lastVisit));

    res.json({
        doctor: {
            id: doctorId,
            name: docData.name || req.profile.name,
            email: docData.email || req.profile.email,
            specialization: docData.specialization || 'General Physician',
            room: docData.room || 'Cabin 101, Ground Floor',
            fee: docData.fee || '$35',
            onDuty: typeof docData.onDuty === 'boolean' ? docData.onDuty : !!req.profile.onDuty,
            schedule: schedDoc.exists ? schedDoc.data() : null
        },
        todayAppointments,
        waitingTokens,
        activeConsultation: calledToken || null,
        completedTodayCount: completedConsultationsCount,
        emergencyCount,
        seniorCount,
        myPatients
    });
});

export default router;
