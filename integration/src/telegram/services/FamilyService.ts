import { db } from '../../firebase/admin';

export interface FamilyMemberRecord {
    id: string;
    chatId: string;
    patientId: string;
    name: string;
    age?: number;
    gender?: string;
    phone?: string;
    relationship: string; // 'Self', 'Spouse', 'Child', 'Parent', 'Sibling', 'Other'
    isVerified: boolean;
    linkedAt: string;
    createdAt?: string;
}

export class FamilyService {
    /**
     * Ensure a telegramAccounts document exists for the given Telegram chat ID.
     */
    static async ensureTelegramAccount(chatId: string | number, userInfo?: { username?: string; firstName?: string; lastName?: string }) {
        const idStr = chatId.toString();
        const accountRef = db.collection('telegramAccounts').doc(idStr);
        const doc = await accountRef.get();
        const now = new Date().toISOString();

        if (!doc.exists) {
            await accountRef.set({
                chatId: idStr,
                username: userInfo?.username || '',
                firstName: userInfo?.firstName || '',
                lastName: userInfo?.lastName || '',
                createdAt: now,
                updatedAt: now
            });
        } else if (userInfo) {
            await accountRef.update({
                username: userInfo.username || '',
                firstName: userInfo.firstName || '',
                lastName: userInfo.lastName || '',
                updatedAt: now
            });
        }
    }

    /**
     * Get all authorized family members managed under this Telegram chat.
     * Also checks and syncs any existing legacy telegramLinks for seamless backward compatibility.
     */
    static async getFamilyMembers(chatId: string | number): Promise<FamilyMemberRecord[]> {
        const idStr = chatId.toString();
        const membersSnap = await db.collection('familyMembers')
            .where('chatId', '==', idStr)
            .get();

        const members: FamilyMemberRecord[] = [];
        const seenPatientIds = new Set<string>();

        membersSnap.forEach(d => {
            const data = d.data();
            seenPatientIds.add(data.patientId);
            members.push({
                id: d.id,
                chatId: data.chatId,
                patientId: data.patientId,
                name: data.patientName || data.name || 'Patient',
                age: data.age,
                gender: data.gender,
                phone: data.phone,
                relationship: data.relationship || 'Self',
                isVerified: !!data.isVerified,
                linkedAt: data.linkedAt || data.createdAt || ''
            });
        });

        // Backward compatibility: Inspect telegramLinks for this chatId
        try {
            const linksSnap = await db.collection('telegramLinks')
                .where('chatId', '==', Number(idStr))
                .get();
            const linksSnap2 = await db.collection('telegramLinks')
                .where('chatId', '==', idStr)
                .get();

            const allLegacyDocs = [...linksSnap.docs, ...linksSnap2.docs];
            for (const doc of allLegacyDocs) {
                const lData = doc.data();
                const pId = lData.patientId || doc.id;
                if (!seenPatientIds.has(pId)) {
                    // Fetch patient details
                    const pDoc = await db.collection('patients').doc(pId).get();
                    if (pDoc.exists) {
                        const pData = pDoc.data()!;
                        const now = new Date().toISOString();
                        const record: FamilyMemberRecord = {
                            id: `${idStr}_${pId}`,
                            chatId: idStr,
                            patientId: pId,
                            name: pData.name || 'Patient',
                            age: pData.age,
                            gender: pData.gender,
                            phone: pData.phone,
                            relationship: 'Self',
                            isVerified: true,
                            linkedAt: lData.linkedAt || now
                        };
                        // Sync to familyMembers
                        await db.collection('familyMembers').doc(`${idStr}_${pId}`).set({
                            ...record,
                            patientName: record.name,
                            createdAt: now
                        }, { merge: true });

                        seenPatientIds.add(pId);
                        members.push(record);
                    }
                }
            }
        } catch (err) {
            console.error('Error syncing legacy telegramLinks in getFamilyMembers:', err);
        }

        return members;
    }

    /**
     * Register a new family member:
     * Creates a new unique patient record and establishes the family relationship.
     */
    static async addFamilyMember(chatId: string | number, data: {
        name: string;
        age: number;
        gender: string;
        phone: string;
        relationship: string;
        notes?: string;
    }): Promise<{ patientId: string; patient: any }> {
        const idStr = chatId.toString();
        await this.ensureTelegramAccount(chatId);

        const now = new Date().toISOString();
        const pRef = db.collection('patients').doc();
        const safeName = (data.name || 'Patient').trim();
        const safePhone = (data.phone || '').trim();
        const safeGender = (data.gender || 'Other').trim();
        const safeAge = typeof data.age === 'number' && !isNaN(data.age) ? data.age : 0;
        const safeRel = (data.relationship || 'Family Member').trim();

        const patientData = {
            name: safeName,
            age: safeAge,
            gender: safeGender,
            phone: safePhone,
            notes: data.notes || `Registered via Telegram Family Account (Chat: ${idStr}, Relationship: ${safeRel})`,
            telegramChatId: idStr,
            telegramLinked: true,
            telegramLinkedAt: now,
            createdAt: now
        };

        // 1. Create independent patient record
        await pRef.set(patientData);

        // 2. Create family member relationship
        await db.collection('familyMembers').doc(`${idStr}_${pRef.id}`).set({
            chatId: idStr,
            patientId: pRef.id,
            patientName: patientData.name,
            age: patientData.age,
            gender: patientData.gender,
            phone: patientData.phone,
            relationship: safeRel,
            isVerified: true,
            linkedAt: now,
            createdAt: now
        });

        // 3. Keep telegramLinks updated for direct lookups
        await db.collection('telegramLinks').doc(pRef.id).set({
            patientId: pRef.id,
            chatId: idStr,
            phone: patientData.phone,
            verified: true,
            linkedAt: now
        }, { merge: true });

        // 4. Set as active patient for this account
        await db.collection('telegramAccounts').doc(idStr).set({
            activePatientId: pRef.id,
            updatedAt: now
        }, { merge: true });

        return { patientId: pRef.id, patient: patientData };
    }

    /**
     * Link an existing patient record to this Telegram family account.
     */
    static async linkExistingPatient(chatId: string | number, patientId: string, relationship: string = 'Family Member'): Promise<boolean> {
        const idStr = chatId.toString();
        const pDoc = await db.collection('patients').doc(patientId).get();
        if (!pDoc.exists) return false;

        const pData = pDoc.data()!;
        const now = new Date().toISOString();

        await this.ensureTelegramAccount(chatId);

        // 1. Establish family member relationship
        await db.collection('familyMembers').doc(`${idStr}_${patientId}`).set({
            chatId: idStr,
            patientId,
            patientName: pData.name,
            age: pData.age,
            gender: pData.gender,
            phone: pData.phone,
            relationship: relationship || 'Family Member',
            isVerified: true,
            linkedAt: now,
            createdAt: now
        }, { merge: true });

        // 2. Update patient record
        await db.collection('patients').doc(patientId).update({
            telegramChatId: idStr,
            telegramLinked: true,
            telegramLinkedAt: now
        });

        // 3. Update telegramLinks
        await db.collection('telegramLinks').doc(patientId).set({
            patientId,
            chatId: idStr,
            phone: pData.phone || '',
            verified: true,
            linkedAt: now
        }, { merge: true });

        // 4. Set active patient
        await db.collection('telegramAccounts').doc(idStr).set({
            activePatientId: patientId,
            updatedAt: now
        }, { merge: true });

        return true;
    }

    /**
     * Get the active patient for a Telegram chat.
     */
    static async getActivePatient(chatId: string | number): Promise<FamilyMemberRecord | null> {
        const idStr = chatId.toString();
        const accountDoc = await db.collection('telegramAccounts').doc(idStr).get();
        const activeId = accountDoc.exists ? accountDoc.data()?.activePatientId : null;

        const members = await this.getFamilyMembers(chatId);
        if (members.length === 0) return null;

        if (activeId) {
            const match = members.find(m => m.patientId === activeId);
            if (match) return match;
        }

        return members[0];
    }

    /**
     * Set the active patient for a Telegram chat.
     */
    static async setActivePatient(chatId: string | number, patientId: string): Promise<boolean> {
        const idStr = chatId.toString();
        const memberDoc = await db.collection('familyMembers').doc(`${idStr}_${patientId}`).get();
        if (!memberDoc.exists) return false;

        await db.collection('telegramAccounts').doc(idStr).set({
            activePatientId: patientId,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        return true;
    }

    /**
     * Helper to normalize a phone number down to its core digits (e.g. last 10 digits).
     */
    static normalizePhone(phone: string): string {
        const digits = (phone || '').replace(/\D/g, '');
        return digits.length > 10 ? digits.slice(-10) : digits;
    }

    /**
     * Resolve a Telegram Chat ID from an identifier (which can be a direct Telegram Chat ID,
     * or a phone number that has been registered/linked in Telegram).
     * If a patientId is provided and a chat is resolved, it also links the patient record.
     */
    static async resolveChatId(identifier: string, patientId?: string): Promise<string | null> {
        if (!identifier) return null;
        const raw = identifier.toString().trim();
        const digits = raw.replace(/\D/g, '');
        if (!digits) return null;

        // 1. Check if the identifier is directly a known Telegram chat ID
        const accountDoc = await db.collection('telegramAccounts').doc(raw).get();
        if (accountDoc.exists) {
            if (patientId) {
                await this.linkPatientToChat(patientId, raw);
            }
            return raw;
        }

        const last10 = this.normalizePhone(digits);
        if (last10.length >= 7) {
            // 2. Search in telegramLinks by phone
            const linksSnap = await db.collection('telegramLinks').get();
            for (const doc of linksSnap.docs) {
                const l = doc.data();
                if (l.verified && l.chatId && this.normalizePhone(l.phone) === last10) {
                    const resolvedChatId = l.chatId.toString();
                    if (patientId) {
                        await this.linkPatientToChat(patientId, resolvedChatId, l.phone);
                    }
                    return resolvedChatId;
                }
            }

            // 3. Search in familyMembers by phone
            const famSnap = await db.collection('familyMembers').get();
            for (const doc of famSnap.docs) {
                const f = doc.data();
                if (f.isVerified && f.chatId && this.normalizePhone(f.phone) === last10) {
                    const resolvedChatId = f.chatId.toString();
                    if (patientId) {
                        await this.linkPatientToChat(patientId, resolvedChatId, f.phone);
                    }
                    return resolvedChatId;
                }
            }

            // 4. Search in patients by phone where telegramLinked is true
            const ptsSnap = await db.collection('patients').where('telegramLinked', '==', true).get();
            for (const doc of ptsSnap.docs) {
                const p = doc.data();
                if (p.telegramChatId && this.normalizePhone(p.phone) === last10) {
                    const resolvedChatId = p.telegramChatId.toString();
                    if (patientId && patientId !== doc.id) {
                        await this.linkPatientToChat(patientId, resolvedChatId, p.phone);
                    }
                    return resolvedChatId;
                }
            }
        }

        // 5. If digits is a 9-13 digit number, check if it matches a chatId in telegramAccounts by doc id or chatId field
        if (digits.length >= 9 && digits.length <= 13) {
            const accByChat = await db.collection('telegramAccounts').where('chatId', '==', digits).limit(1).get();
            if (!accByChat.empty) {
                if (patientId) {
                    await this.linkPatientToChat(patientId, digits);
                }
                return digits;
            }
        }

        return null;
    }

    /**
     * Helper to link a patient to a Telegram Chat ID across Firestore collections.
     */
    static async linkPatientToChat(patientId: string, chatId: string, phone?: string): Promise<void> {
        try {
            const idStr = chatId.toString();
            const now = new Date().toISOString();
            const pRef = db.collection('patients').doc(patientId);
            const pDoc = await pRef.get();
            const pData = pDoc.exists ? pDoc.data() : {};
            const finalPhone = phone || pData?.phone || '';

            await pRef.update({
                telegramChatId: idStr,
                telegramLinked: true,
                telegramLinkedAt: now
            });

            await db.collection('telegramLinks').doc(patientId).set({
                patientId,
                chatId: idStr,
                phone: finalPhone,
                verified: true,
                linkedAt: now
            }, { merge: true });

            await db.collection('familyMembers').doc(`${idStr}_${patientId}`).set({
                chatId: idStr,
                patientId,
                patientName: pData?.name || 'Patient',
                age: pData?.age,
                gender: pData?.gender,
                phone: finalPhone,
                relationship: 'Self',
                isVerified: true,
                linkedAt: now
            }, { merge: true });
        } catch (e) {
            console.warn('Could not auto-link patient to chat:', e);
        }
    }

    /**
     * Resolve the authorized Telegram chat ID for a patient.
     * Looks up familyMembers first, then telegramLinks, then patients, then resolves by phone.
     */
    static async getAuthorizedChatForPatient(patientId: string, phone?: string): Promise<string | null> {
        if (!patientId) return null;

        // 1. Search in familyMembers (verified relationships)
        const famSnap = await db.collection('familyMembers')
            .where('patientId', '==', patientId)
            .where('isVerified', '==', true)
            .limit(1)
            .get();

        if (!famSnap.empty) {
            const data = famSnap.docs[0].data();
            if (data.chatId) return data.chatId.toString();
        }

        // 2. Search in telegramLinks
        const linkDoc = await db.collection('telegramLinks').doc(patientId).get();
        if (linkDoc.exists && linkDoc.data()?.verified && linkDoc.data()?.chatId) {
            return linkDoc.data()!.chatId.toString();
        }

        // 3. Search in patients collection
        const pDoc = await db.collection('patients').doc(patientId).get();
        if (pDoc.exists) {
            const pData = pDoc.data()!;
            if (pData.telegramLinked && pData.telegramChatId) {
                return pData.telegramChatId.toString();
            }
            // 4. If not directly linked by patientId, resolve via phone number or stored telegram fields
            const ptPhone = phone || pData.phone || pData.telegramPhone || pData.telegramChatId;
            if (ptPhone) {
                const resolved = await this.resolveChatId(ptPhone, patientId);
                if (resolved) return resolved;
            }
        } else if (phone) {
            const resolved = await this.resolveChatId(phone, patientId);
            if (resolved) return resolved;
        }

        return null;
    }
}
