import { db } from '../../firebase/admin';

export interface TelegramSession {
    state: string;
    patientId?: string | null;
    patientName?: string | null;
    phone?: string | null;
    phoneVerified?: boolean;
    fam_name?: string | null;
    fam_age?: number | null;
    fam_gender?: string | null;
    fam_phone?: string | null;
    fam_relationship?: string | null;
    registrationName?: string | null;
    registrationAge?: number | null;
    booking_spec?: string | null;
    booking_doc_id?: string | null;
    booking_doc_name?: string | null;
    booking_date_val?: string | null;
    booking_time_val?: string | null;
    [key: string]: any;
}

export class SessionService {
    static async getSession(chatId: number | string): Promise<TelegramSession> {
        try {
            const doc = await db.collection('telegramSessions').doc(chatId.toString()).get();
            if (!doc.exists) {
                return { state: 'IDLE' };
            }
            const data = (doc.data() || {}) as TelegramSession;
            return {
                ...data,
                state: data.state || 'IDLE'
            };
        } catch (e) {
            console.error(`Error getting session for ${chatId}:`, e);
            return { state: 'IDLE' };
        }
    }

    static async updateSession(chatId: number | string, data: Partial<TelegramSession>): Promise<void> {
        await db.collection('telegramSessions').doc(chatId.toString()).set(data, { merge: true });
    }

    static async clearSession(chatId: number | string): Promise<void> {
        const current = await this.getSession(chatId);
        await db.collection('telegramSessions').doc(chatId.toString()).set({
            state: 'IDLE',
            patientId: current.patientId || null,
            patientName: current.patientName || null,
            phone: current.phone || null,
            phoneVerified: current.phoneVerified || false,
            fam_name: null,
            fam_age: null,
            fam_gender: null,
            fam_phone: null,
            fam_relationship: null,
            registrationName: null,
            registrationAge: null,
            booking_spec: null,
            booking_doc_id: null,
            booking_doc_name: null,
            booking_date_val: null,
            booking_time_val: null
        }, { merge: true });
    }
}
