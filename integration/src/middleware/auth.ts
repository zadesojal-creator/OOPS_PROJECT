import { Request, Response, NextFunction } from 'express';
import { auth, db, formatDoc } from '../firebase/admin';

// Extend Express Request to include our authenticated profile
declare global {
    namespace Express {
        interface Request {
            profile?: any;
        }
    }
}

// 1. Authenticate using Firebase ID Token
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'A Firebase ID token is required' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        const uid = decodedToken.uid;

        // Fetch user from Firestore
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return res.status(403).json({ message: 'No active clinic role is assigned to this account' });
        }

        const profile = formatDoc(userDoc);
        
        // Match clinic roles including PATIENT
        const role = profile.role;
        const validRoles = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'];
        if (profile.active === false || !validRoles.includes(role)) {
            return res.status(403).json({ message: 'This account is inactive or has no valid clinic role' });
        }

        // If patient, ensure patientId is linked
        if (role === 'PATIENT' && !profile.patientId) {
            let patientId = '';
            // 1. Try finding patient with matching email
            if (profile.email) {
                const pEmailSnap = await db.collection('patients').where('email', '==', profile.email).limit(1).get();
                if (!pEmailSnap.empty) {
                    patientId = pEmailSnap.docs[0].id;
                }
            }
            // 2. Try finding patient with matching phone
            if (!patientId && profile.phone) {
                const pPhoneSnap = await db.collection('patients').where('phone', '==', profile.phone).limit(1).get();
                if (!pPhoneSnap.empty) {
                    patientId = pPhoneSnap.docs[0].id;
                }
            }
            // 3. Try patient with doc id = uid
            if (!patientId) {
                const directPatientDoc = await db.collection('patients').doc(uid).get();
                if (directPatientDoc.exists) {
                    patientId = uid;
                }
            }
            // 4. Create patient record if none exists
            if (!patientId) {
                const newPRef = db.collection('patients').doc(uid);
                await newPRef.set({
                    name: profile.name || 'Patient',
                    email: profile.email || '',
                    phone: profile.phone || '',
                    age: profile.age || 30,
                    gender: profile.gender || 'Other',
                    notes: '',
                    createdAt: new Date().toISOString()
                });
                patientId = uid;
            }

            profile.patientId = patientId;
            await db.collection('users').doc(uid).update({ patientId });
        }

        req.profile = profile;
        next();
    } catch (error: any) {
        return res.status(401).json({ message: 'Firebase ID token is invalid or expired' });
    }
};

// 2. Role-based Authorization
export const authorize = (allowedRoles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.profile) {
            return res.status(401).json({ message: 'Authentication required' });
        }
        
        if (allowedRoles.length > 0 && !allowedRoles.includes(req.profile.role)) {
            return res.status(403).json({ message: 'This role is not allowed to perform this action' });
        }
        
        next();
    };
};
