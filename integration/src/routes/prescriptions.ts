import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { db, formatDoc } from '../firebase/admin';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { getBot } from '../telegram/bot';
import { FamilyService } from '../telegram/services/FamilyService';
import { sendPrescriptionEmail } from '../services/email';

const router = Router();

function getPrescriptionDir(): string {
    const dir = process.env.PRESCRIPTION_DIR || path.resolve(__dirname, '../../../../backend/storage/prescriptions');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function digitsOnly(value: string): string {
    return (value || '').replace(/\D/g, '');
}

function maskPhone(phone: string): string {
    if (!phone) return '—';
    const digits = phone.trim();
    if (digits.length <= 4) return '****';
    return digits.slice(0, 3) + ' ' + '*'.repeat(Math.max(3, digits.length - 7)) + ' ' + digits.slice(-4);
}

// Helper to generate the professional A4 PDF
async function generatePrescriptionPdf(filePath: string, data: {
    prescriptionId: string;
    date: string;
    doctorName: string;
    doctorSpecialization: string;
    doctorRoom?: string;
    patientName: string;
    patientAge?: number;
    patientGender?: string;
    patientPhone?: string;
    patientId: string;
    consultationId?: string;
    diagnosis: string;
    medications: Array<{
        name: string;
        dosage: string;
        frequency?: string;
        duration: string;
        instructions?: string;
    }>;
    instructions?: string;
    followUpDate?: string;
}): Promise<number> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4', // 595.28 x 841.89 points
            margins: { top: 40, bottom: 45, left: 45, right: 45 },
            bufferPages: true
        });

        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const primaryColor = '#1e3a8a';   // Deep Blue
        const secondaryColor = '#0f766e'; // Teal
        const darkTextColor = '#1e293b';  // Slate 800
        const lightTextColor = '#64748b'; // Slate 500
        const borderColor = '#cbd5e1';    // Slate 300
        const tableBg = '#f8fafc';        // Slate 50

        // 1. Header Banner
        doc.rect(45, 40, 505.28, 4).fill(primaryColor);
        doc.moveDown(0.6);

        // Clinic Branding
        doc.fontSize(20).fillColor(primaryColor).font('Helvetica-Bold')
            .text('CLINICQUEUE HEALTHCARE SYSTEM', 45, 52, { align: 'left' });
        
        doc.fontSize(9).fillColor(lightTextColor).font('Helvetica')
            .text('Multi-Specialty Outpatient Clinic & Diagnostic Care Centre', 45, 75);
        doc.text('100 Medical Enclave, Health City • Tel: +1 (555) 019-2834 • care@clinicqueue.health', 45, 87);

        doc.strokeColor(borderColor).lineWidth(1).moveTo(45, 102).lineTo(550.28, 102).stroke();

        // 2. Doctor & Patient Info Boxes (Two Column Layout)
        const infoTop = 112;
        const boxWidth = 245;
        const boxHeight = 78;

        // Patient Box (Left)
        doc.roundedRect(45, infoTop, boxWidth, boxHeight, 4).fillAndStroke(tableBg, borderColor);
        doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('PATIENT INFORMATION', 53, infoTop + 7);
        doc.fillColor(darkTextColor).fontSize(10).font('Helvetica-Bold').text(data.patientName, 53, infoTop + 20);
        doc.fontSize(8.5).font('Helvetica').fillColor(darkTextColor);
        const ageGender = [
            data.patientAge ? `${data.patientAge} yrs` : null,
            data.patientGender || null
        ].filter(Boolean).join(' • ');
        doc.text(`Age/Gender: ${ageGender || 'N/A'}`, 53, infoTop + 34);
        doc.text(`Phone: ${data.patientPhone || 'N/A'}`, 53, infoTop + 47);
        doc.text(`Patient ID: ${data.patientId.slice(0, 14)}`, 53, infoTop + 60);

        // Doctor Box (Right)
        const rightX = 305.28;
        doc.roundedRect(rightX, infoTop, boxWidth, boxHeight, 4).fillAndStroke(tableBg, borderColor);
        doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('TREATING PHYSICIAN & VISIT', rightX + 8, infoTop + 7);
        doc.fillColor(darkTextColor).fontSize(10).font('Helvetica-Bold').text(`Dr. ${data.doctorName}`, rightX + 8, infoTop + 20);
        doc.fontSize(8.5).font('Helvetica').fillColor(darkTextColor);
        doc.text(`Specialization: ${data.doctorSpecialization}`, rightX + 8, infoTop + 34);
        doc.text(`Date: ${data.date}`, rightX + 8, infoTop + 47);
        doc.text(`Prescription #: ${data.prescriptionId.slice(0, 14)}`, rightX + 8, infoTop + 60);

        let currentY = infoTop + boxHeight + 14;

        // 3. Diagnosis Box
        doc.roundedRect(45, currentY, 505.28, 38, 4).fillAndStroke('#f0fdf4', '#86efac');
        doc.fillColor('#15803d').fontSize(8.5).font('Helvetica-Bold').text('CLINICAL DIAGNOSIS', 53, currentY + 6);
        doc.fillColor('#166534').fontSize(10).font('Helvetica').text(data.diagnosis || 'Routine Evaluation', 53, currentY + 19, { width: 490 });

        currentY += 48;

        // 4. Rx Medications Table
        doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold').text('PRESCRIPTION (Rx)', 45, currentY);
        currentY += 16;

        // Table Header
        const colX = {
            num: 45,
            name: 68,
            dosage: 198,
            freq: 278,
            duration: 358,
            instructions: 433
        };

        const tableWidth = 505.28;
        doc.rect(45, currentY, tableWidth, 20).fill(primaryColor);
        doc.fillColor('#ffffff').fontSize(8.5).font('Helvetica-Bold');
        doc.text('#', colX.num + 4, currentY + 5);
        doc.text('Medication', colX.name, currentY + 5);
        doc.text('Dosage', colX.dosage, currentY + 5);
        doc.text('Frequency', colX.freq, currentY + 5);
        doc.text('Duration', colX.duration, currentY + 5);
        doc.text('Instructions', colX.instructions, currentY + 5);

        currentY += 20;

        // Medication Rows
        data.medications.forEach((med, idx) => {
            const isEven = idx % 2 === 0;
            const rowHeight = 22;

            if (currentY + rowHeight > 680) {
                doc.addPage();
                currentY = 45;
            }

            if (isEven) {
                doc.rect(45, currentY, tableWidth, rowHeight).fill('#f8fafc');
            }

            doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(45, currentY + rowHeight).lineTo(550.28, currentY + rowHeight).stroke();

            doc.fillColor(darkTextColor).fontSize(8.5).font('Helvetica');
            doc.text(String(idx + 1), colX.num + 4, currentY + 6);
            doc.font('Helvetica-Bold').text(med.name, colX.name, currentY + 6, { width: 125, lineBreak: false });
            doc.font('Helvetica').text(med.dosage || '—', colX.dosage, currentY + 6, { width: 75, lineBreak: false });
            doc.text(med.frequency || '1-0-1', colX.freq, currentY + 6, { width: 75, lineBreak: false });
            doc.text(med.duration || '—', colX.duration, currentY + 6, { width: 70, lineBreak: false });
            doc.text(med.instructions || 'After meals', colX.instructions, currentY + 6, { width: 110, lineBreak: false });

            currentY += rowHeight;
        });

        currentY += 14;

        // 5. General Instructions Section
        if (data.instructions) {
            if (currentY + 50 > 700) {
                doc.addPage();
                currentY = 45;
            }

            doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text('ADVICE & GENERAL INSTRUCTIONS', 45, currentY);
            currentY += 14;
            doc.roundedRect(45, currentY, 505.28, 38, 4).fillAndStroke(tableBg, borderColor);
            doc.fillColor(darkTextColor).fontSize(8.5).font('Helvetica').text(data.instructions, 53, currentY + 7, { width: 490 });
            currentY += 46;
        }

        // 6. Follow-up Advice Section
        if (data.followUpDate) {
            if (currentY + 30 > 710) {
                doc.addPage();
                currentY = 45;
            }
            doc.roundedRect(45, currentY, 505.28, 24, 4).fillAndStroke('#eff6ff', '#bfdbfe');
            doc.fillColor('#1d4ed8').fontSize(8.5).font('Helvetica-Bold')
                .text(`NEXT FOLLOW-UP: ${data.followUpDate} (or earlier if symptoms persist)`, 53, currentY + 7);
            currentY += 32;
        }

        // 7. Doctor's Signature Block (Anchored above footer)
        const signatureY = Math.max(currentY + 15, 715);
        doc.strokeColor(borderColor).lineWidth(1).moveTo(365, signatureY).lineTo(540, signatureY).stroke();
        doc.fillColor(darkTextColor).fontSize(9.5).font('Helvetica-Bold').text(`Dr. ${data.doctorName}`, 365, signatureY + 5);
        doc.fontSize(8).font('Helvetica').fillColor(lightTextColor).text(data.doctorSpecialization, 365, signatureY + 17);
        doc.text('Verified Clinic Physician • ClinicQueue', 365, signatureY + 28);

        // 8. Footer (Page numbers across all pages)
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            const footerY = 800;
            doc.strokeColor(borderColor).lineWidth(0.5).moveTo(45, footerY - 8).lineTo(550.28, footerY - 8).stroke();
            doc.fontSize(7.5).font('Helvetica').fillColor(lightTextColor);
            doc.text('ClinicQueue Electronic Health Record • This is a verified electronic prescription.', 45, footerY);
            doc.text(`Page ${i + 1} of ${pages.count}`, 45, footerY, { align: 'right' });
        }

        doc.end();

        stream.on('finish', () => {
            const stats = fs.statSync(filePath);
            resolve(stats.size);
        });
        stream.on('error', reject);
    });
}

// GET /api/prescriptions
router.get('/', authenticate, async (req, res) => {
    let { patientId, doctorId, consultationId } = req.query;

    if (req.profile.role === 'PATIENT') {
        const myPatientId = req.profile.patientId;
        if (patientId && patientId !== myPatientId) {
            return res.status(403).json({ message: 'Access denied. You can only view your own prescriptions.' });
        }
        patientId = myPatientId;
    }

    let query: FirebaseFirestore.Query = db.collection('prescriptions');
    if (patientId) query = query.where('patientId', '==', patientId as string);
    if (doctorId) query = query.where('doctorId', '==', doctorId as string);
    if (consultationId) query = query.where('consultationId', '==', consultationId as string);

    const snapshot = await query.get();
    const prescriptions = snapshot.docs.map(doc => {
        const p = formatDoc(doc);
        delete p.filePath;
        p.downloadUrl = `/api/prescriptions/${p.id}/pdf`;
        return p;
    });

    res.json(prescriptions);
});

// POST /api/prescriptions (DOCTOR ONLY)
router.post('/', authenticate, authorize(['DOCTOR']), async (req, res) => {
    const { consultationId, medications, instructions, followUpDate } = req.body;
    
    if (!consultationId || !Array.isArray(medications) || medications.length === 0) {
        return res.status(400).json({ message: 'consultationId and a non-empty medications array are required' });
    }

    // Validate each medication
    for (const m of medications) {
        if (!m.name || !m.name.trim()) {
            return res.status(400).json({ message: 'All medications must have a valid medicine name' });
        }
    }
    
    const cDoc = await db.collection('consultations').doc(consultationId).get();
    if (!cDoc.exists) return res.status(404).json({ message: 'Consultation not found' });
    
    const cData = cDoc.data()!;
    const doctorId = req.profile.uid;
    const doctorName = req.profile.name || cData.doctorName;

    // Fetch verified doctor details for credentials
    const docUserDoc = await db.collection('users').doc(doctorId).get();
    const doctorSpecialization = docUserDoc.exists ? docUserDoc.data()?.specialization || 'General Physician' : 'General Physician';
    const doctorRoom = docUserDoc.exists ? docUserDoc.data()?.room : '';

    // Fetch verified patient details
    const pDoc = await db.collection('patients').doc(cData.patientId).get();
    const pData = pDoc.exists ? pDoc.data() : {};
    
    const pRef = db.collection('prescriptions').doc();
    const fileName = `${pRef.id}.pdf`;
    const filePath = path.join(getPrescriptionDir(), fileName);
    
    const formattedDate = new Date().toISOString().split('T')[0];

    // Format medications
    const formattedMedications = medications.map(m => ({
        name: m.name.trim(),
        dosage: (m.dosage || '1 tablet').trim(),
        frequency: (m.frequency || '1-0-1').trim(),
        duration: (m.duration || '5 days').trim(),
        instructions: (m.instructions || '').trim()
    }));

    try {
        const sizeBytes = await generatePrescriptionPdf(filePath, {
            prescriptionId: pRef.id,
            date: formattedDate,
            doctorName,
            doctorSpecialization,
            doctorRoom,
            patientName: cData.patientName || pData?.name || 'Patient',
            patientAge: pData?.age,
            patientGender: pData?.gender,
            patientPhone: pData?.phone,
            patientId: cData.patientId,
            consultationId,
            diagnosis: cData.diagnosis || 'Clinical Consultation',
            medications: formattedMedications,
            instructions: instructions ? instructions.trim() : '',
            followUpDate: followUpDate ? followUpDate.trim() : ''
        });

        // Resolve authorized Telegram account via verified Family / Telegram relationship or patient contact
        const authorizedChatId = await FamilyService.getAuthorizedChatForPatient(cData.patientId, pData?.phone);
        let deliveryStatus: any = {
            status: 'TELEGRAM_NOT_CONFIGURED',
            error: 'No authorized Telegram account linked for this patient.'
        };

        if (authorizedChatId) {
            const bot = getBot();
            if (bot) {
                try {
                    const consultationDate = formattedDate;
                    const caption = `📋 *ClinicQueue Healthcare System — Official Prescription*\n\n` +
                        `👨‍⚕️ *Physician:* Dr. ${doctorName} (${doctorSpecialization})\n` +
                        `👤 *Patient:* ${cData.patientName || pData?.name || 'Patient'} (Age: ${pData?.age || '—'}, ${pData?.gender || '—'})\n` +
                        `📅 *Consultation Date:* ${consultationDate}\n\n` +
                        `Dear ${cData.patientName || pData?.name || 'Patient'}, your official clinical prescription PDF is attached below. Review all dosage schedules and follow-up guidance.\n\n` +
                        `Wishing you good health and a speedy recovery!`;

                    await bot.sendDocument(authorizedChatId, filePath, {
                        caption,
                        parse_mode: 'Markdown'
                    });

                    deliveryStatus = {
                        status: 'SENT',
                        sentAt: new Date().toISOString(),
                        chatId: authorizedChatId,
                        recipientName: cData.patientName || pData?.name || 'Patient'
                    };

                    await db.collection('telegramDeliveryLogs').add({
                        prescriptionId: pRef.id,
                        patientId: cData.patientId,
                        doctorId,
                        doctorName,
                        chatId: authorizedChatId,
                        status: 'SENT',
                        timestamp: deliveryStatus.sentAt
                    });
                } catch (err: any) {
                    console.error('Automatic Telegram delivery failed:', err);
                    deliveryStatus = {
                        status: 'FAILED',
                        triedAt: new Date().toISOString(),
                        chatId: authorizedChatId,
                        error: err.message || 'Telegram network delivery failed'
                    };

                    await db.collection('telegramDeliveryLogs').add({
                        prescriptionId: pRef.id,
                        patientId: cData.patientId,
                        doctorId,
                        doctorName,
                        chatId: authorizedChatId,
                        status: 'FAILED',
                        error: deliveryStatus.error,
                        timestamp: deliveryStatus.triedAt
                    });
                }
            } else {
                deliveryStatus = {
                    status: 'FAILED',
                    triedAt: new Date().toISOString(),
                    chatId: authorizedChatId,
                    error: 'Telegram bot service is offline or not configured.'
                };
            }
        }

        // Automatic Email Delivery check
        const patientEmail = (req.body.email || pData?.email || '').trim().toLowerCase();
        let emailDeliveryStatus: any = {
            status: patientEmail ? 'PENDING' : 'NOT_SENT',
            recipientEmail: patientEmail || ''
        };

        if (patientEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail)) {
            try {
                const emailRes = await sendPrescriptionEmail({
                    to: patientEmail,
                    patientName: cData.patientName || pData?.name || 'Patient',
                    patientAge: pData?.age,
                    patientGender: pData?.gender,
                    patientId: cData.patientId,
                    doctorName,
                    doctorSpecialization,
                    diagnosis: cData.diagnosis || 'Clinical Consultation',
                    medications: formattedMedications,
                    instructions: instructions ? instructions.trim() : '',
                    followUpDate: followUpDate ? followUpDate.trim() : '',
                    consultationDate: formattedDate,
                    filePath,
                    fileName
                });

                emailDeliveryStatus = {
                    status: 'SENT',
                    sentAt: new Date().toISOString(),
                    recipientEmail: patientEmail,
                    messageId: emailRes.messageId
                };

                await db.collection('emailDeliveryLogs').add({
                    prescriptionId: pRef.id,
                    patientId: cData.patientId,
                    doctorId,
                    doctorName,
                    recipientEmail: patientEmail,
                    status: 'SENT',
                    messageId: emailRes.messageId,
                    timestamp: emailDeliveryStatus.sentAt
                });
            } catch (emailErr: any) {
                console.error('[Prescriptions] Automatic email delivery encountered an error:', emailErr);
                emailDeliveryStatus = {
                    status: 'FAILED',
                    triedAt: new Date().toISOString(),
                    recipientEmail: patientEmail,
                    error: emailErr.message || 'SMTP transmission failed'
                };
            }
        }

        const pDataRecord = {
            consultationId,
            appointmentId: cData.appointmentId || null,
            patientId: cData.patientId,
            patientName: cData.patientName || pData?.name || 'Patient',
            doctorId,
            doctorName,
            doctorSpecialization,
            diagnosis: cData.diagnosis,
            medications: formattedMedications,
            instructions: instructions ? instructions.trim() : '',
            followUpDate: followUpDate ? followUpDate.trim() : '',
            fileName,
            mimeType: 'application/pdf',
            sizeBytes,
            filePath,
            downloadUrl: `/api/prescriptions/${pRef.id}/pdf`,
            telegramDelivery: deliveryStatus,
            emailDelivery: emailDeliveryStatus,
            createdAt: new Date().toISOString()
        };
        
        await pRef.set(pDataRecord);
        
        res.status(201).json({
            id: pRef.id,
            ...pDataRecord
        });
    } catch (err: any) {
        console.error('Error generating prescription PDF:', err);
        res.status(500).json({ message: `PDF generation failed: ${err.message}` });
    }
});

// GET /api/prescriptions/:id/pdf (Download and preview)
router.get('/:id/pdf', authenticate, authorize(['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT']), async (req, res) => {
    const pDoc = await db.collection('prescriptions').doc(req.params.id).get();
    if (!pDoc.exists) return res.status(404).json({ message: 'Prescription not found' });
    
    const pData = pDoc.data()!;

    // Enforce patient ownership
    if (req.profile.role === 'PATIENT' && req.profile.patientId !== pData.patientId) {
        return res.status(403).json({ message: 'Access denied. You can only download your own prescriptions.' });
    }

    const filePath = pData.filePath;
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'PDF file missing on server' });
    }
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${pData.fileName}"`);
    fs.createReadStream(filePath).pipe(res);
});

// POST /api/prescriptions/:id/verify-recipient (DOCTOR ONLY)
router.post('/:id/verify-recipient', authenticate, authorize(['DOCTOR']), async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ message: 'Phone number is required' });
    }

    const pDoc = await db.collection('prescriptions').doc(req.params.id).get();
    if (!pDoc.exists) return res.status(404).json({ message: 'Prescription not found' });
    const pData = pDoc.data()!;

    const searchDigits = digitsOnly(phone);
    if (searchDigits.length < 7) {
        return res.status(400).json({ message: 'Please enter a valid phone number with at least 7 digits.' });
    }

    // Search patient by normalized phone
    const patientsSnap = await db.collection('patients').get();
    const matchingPatients: any[] = [];
    const searchNormalized = FamilyService.normalizePhone(phone);
    patientsSnap.forEach(d => {
        const pt = formatDoc(d);
        if (digitsOnly(pt.phone) === searchDigits || FamilyService.normalizePhone(pt.phone) === searchNormalized) {
            matchingPatients.push(pt);
        }
    });

    if (matchingPatients.length === 0) {
        return res.json({
            matched: false,
            message: 'No patient record found with this phone number. Please verify the phone number.'
        });
    }

    let matchedPatient = matchingPatients.find(p => p.id === pData.patientId);
    if (!matchedPatient && req.body.patientId) {
        matchedPatient = matchingPatients.find(p => p.id === req.body.patientId);
    }

    if (!matchedPatient) {
        if (matchingPatients.length > 1) {
            return res.json({
                matched: false,
                ambiguous: true,
                matches: matchingPatients.map(p => ({ id: p.id, name: p.name, phone: maskPhone(p.phone) })),
                message: `Multiple patients share this phone number, but none match the treated patient (${pData.patientName}).`
            });
        }
        matchedPatient = matchingPatients[0];
    }

    // Confirm that the selected patient matches the prescription's patient
    const patientMatchesPrescription = (matchedPatient.id === pData.patientId);
    if (!patientMatchesPrescription) {
        return res.json({
            matched: false,
            mismatch: true,
            patientName: matchedPatient.name,
            prescriptionPatientName: pData.patientName,
            message: `Warning: This phone number belongs to ${matchedPatient.name}, not ${pData.patientName}. Prescriptions can only be sent to the treated patient.`
        });
    }

    // Check linked Telegram account
    let isLinked = !!matchedPatient.telegramLinked;
    let chatId = matchedPatient.telegramChatId;

    if (!isLinked) {
        const linkDoc = await db.collection('telegramLinks').doc(matchedPatient.id).get();
        if (linkDoc.exists && linkDoc.data()?.verified) {
            isLinked = true;
            chatId = linkDoc.data()?.chatId;
        }
    }

    if (!isLinked) {
        const resolvedChat = await FamilyService.resolveChatId(phone, matchedPatient.id);
        if (resolvedChat) {
            isLinked = true;
            chatId = resolvedChat;
        }
    }

    if (!isLinked) {
        return res.json({
            matched: true,
            patientId: matchedPatient.id,
            patientName: matchedPatient.name,
            phoneMasked: maskPhone(matchedPatient.phone),
            isLinked: false,
            message: 'This patient does not have a verified Telegram account linked to ClinicQueue. Ask the patient to start the clinic bot and link their phone number.'
        });
    }

    res.json({
        matched: true,
        patientId: matchedPatient.id,
        patientName: matchedPatient.name,
        phoneMasked: maskPhone(matchedPatient.phone),
        isLinked: true,
        chatId,
        message: 'Verified Telegram account linked and ready.'
    });
});

// POST /api/prescriptions/:id/send-telegram (DOCTOR ONLY)
router.post('/:id/send-telegram', authenticate, authorize(['DOCTOR']), async (req, res) => {
    const { phone, chatId: directChatId } = req.body;

    const pDoc = await db.collection('prescriptions').doc(req.params.id).get();
    if (!pDoc.exists) return res.status(404).json({ message: 'Prescription not found' });
    const pData = pDoc.data()!;

    // Resolve patient
    const patientId = pData.patientId;
    const patientDoc = await db.collection('patients').doc(patientId).get();
    const patientData = patientDoc.exists ? patientDoc.data() : {};

    // Determine target chatId
    let chatId = directChatId || patientData?.telegramChatId;
    if (!chatId) {
        const linkDoc = await db.collection('telegramLinks').doc(patientId).get();
        if (linkDoc.exists && linkDoc.data()?.verified) {
            chatId = linkDoc.data()?.chatId;
        }
    }

    // Try resolving chatId via FamilyService with phone or stored contacts
    if (!chatId) {
        chatId = await FamilyService.getAuthorizedChatForPatient(patientId, phone || patientData?.phone);
    }
    if (!chatId && phone) {
        chatId = await FamilyService.resolveChatId(phone, patientId);
    }

    if (!chatId) {
        const notLinkedStatus = {
            status: 'NOT_LINKED',
            triedAt: new Date().toISOString(),
            error: 'This patient does not have a verified Telegram account linked to ClinicQueue. Ask the patient to start the clinic bot and link their phone number.'
        };
        await db.collection('prescriptions').doc(req.params.id).update({ telegramDelivery: notLinkedStatus });
        return res.status(400).json({
            message: notLinkedStatus.error,
            telegramDelivery: notLinkedStatus
        });
    }

    const filePath = pData.filePath;
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'Prescription PDF file not found on disk.' });
    }

    const bot = getBot();
    if (!bot) {
        const failedStatus = {
            status: 'FAILED',
            triedAt: new Date().toISOString(),
            error: 'Telegram bot service is not available.'
        };
        await db.collection('prescriptions').doc(req.params.id).update({ telegramDelivery: failedStatus });
        return res.status(503).json({
            message: 'Telegram service unavailable.',
            telegramDelivery: failedStatus
        });
    }

    try {
        const consultationDate = pData.createdAt ? pData.createdAt.split('T')[0] : new Date().toLocaleDateString();
        const caption = `📋 *ClinicQueue Healthcare System*\n\n` +
            `👨‍⚕️ *Doctor:* Dr. ${pData.doctorName}\n` +
            `📅 *Consultation Date:* ${consultationDate}\n\n` +
            `Dear ${pData.patientName}, attached is your official digital prescription. Please review the dosage instructions and follow-up advice.\n\n` +
            `Wishing you a speedy recovery!`;

        await bot.sendDocument(chatId, filePath, {
            caption,
            parse_mode: 'Markdown'
        });

        const deliveryStatus = {
            status: 'SENT',
            sentAt: new Date().toISOString(),
            chatId,
            recipientPhone: phone || patientData?.phone || ''
        };

        // Update prescription
        await db.collection('prescriptions').doc(req.params.id).update({
            telegramDelivery: deliveryStatus
        });

        // Log to delivery logs
        await db.collection('telegramDeliveryLogs').add({
            prescriptionId: req.params.id,
            patientId,
            doctorId: req.profile.uid,
            doctorName: req.profile.name,
            chatId,
            status: 'SENT',
            timestamp: deliveryStatus.sentAt
        });

        res.json({
            success: true,
            message: `Prescription successfully sent to Telegram recipient.`,
            telegramDelivery: deliveryStatus
        });
    } catch (err: any) {
        console.error('Failed to send Telegram prescription:', err);
        const deliveryStatus = {
            status: 'FAILED',
            triedAt: new Date().toISOString(),
            chatId,
            error: err.message || 'Telegram network delivery failed'
        };

        // Preserve prescription record and record error
        await db.collection('prescriptions').doc(req.params.id).update({
            telegramDelivery: deliveryStatus
        });

        await db.collection('telegramDeliveryLogs').add({
            prescriptionId: req.params.id,
            patientId,
            doctorId: req.profile.uid,
            chatId,
            status: 'FAILED',
            error: deliveryStatus.error,
            timestamp: deliveryStatus.triedAt
        });

        res.status(502).json({
            success: false,
            message: `Telegram delivery failed: ${deliveryStatus.error}. You can retry or skip.`,
            telegramDelivery: deliveryStatus
        });
    }
});

// POST /api/prescriptions/:id/retry-telegram (DOCTOR, ADMIN, RECEPTIONIST)
router.post('/:id/retry-telegram', authenticate, authorize(['DOCTOR', 'ADMIN', 'RECEPTIONIST']), async (req, res) => {
    const pRef = db.collection('prescriptions').doc(req.params.id);
    const pDoc = await pRef.get();
    if (!pDoc.exists) return res.status(404).json({ message: 'Prescription not found' });
    const pData = pDoc.data()!;

    const filePath = pData.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'Prescription PDF file not found on server.' });
    }

    const { phone, chatId: directChatId } = req.body;
    let authorizedChatId = directChatId;
    if (!authorizedChatId) {
        authorizedChatId = await FamilyService.getAuthorizedChatForPatient(pData.patientId, phone);
    }
    if (!authorizedChatId && phone) {
        authorizedChatId = await FamilyService.resolveChatId(phone, pData.patientId);
    }

    if (!authorizedChatId) {
        const deliveryStatus = {
            status: 'TELEGRAM_NOT_CONFIGURED',
            error: 'No authorized Telegram account linked for this patient.',
            triedAt: new Date().toISOString()
        };
        await pRef.update({ telegramDelivery: deliveryStatus });
        return res.status(400).json({
            success: false,
            message: 'Patient has not linked their Telegram account.',
            telegramDelivery: deliveryStatus
        });
    }

    const bot = getBot();
    if (!bot) {
        const deliveryStatus = {
            status: 'FAILED',
            triedAt: new Date().toISOString(),
            chatId: authorizedChatId,
            error: 'Telegram bot service is offline or not configured.'
        };
        await pRef.update({ telegramDelivery: deliveryStatus });
        return res.status(503).json({
            success: false,
            message: 'Telegram service unavailable.',
            telegramDelivery: deliveryStatus
        });
    }

    try {
        const consultationDate = pData.createdAt ? pData.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];
        const caption = `📋 *ClinicQueue Healthcare System — Official Prescription (Resent)*\n\n` +
            `👨‍⚕️ *Physician:* Dr. ${pData.doctorName} (${pData.doctorSpecialization || 'Physician'})\n` +
            `👤 *Patient:* ${pData.patientName} (ID: ${pData.patientId})\n` +
            `📅 *Date:* ${consultationDate}\n\n` +
            `Dear ${pData.patientName}, your official clinical prescription PDF is attached below. Review all dosage schedules and follow-up guidance.\n\n` +
            `Wishing you good health!`;

        await bot.sendDocument(authorizedChatId, filePath, {
            caption,
            parse_mode: 'Markdown'
        });

        const deliveryStatus = {
            status: 'SENT',
            sentAt: new Date().toISOString(),
            chatId: authorizedChatId,
            recipientName: pData.patientName
        };

        await pRef.update({ telegramDelivery: deliveryStatus });

        await db.collection('telegramDeliveryLogs').add({
            prescriptionId: req.params.id,
            patientId: pData.patientId,
            doctorId: pData.doctorId,
            doctorName: pData.doctorName,
            chatId: authorizedChatId,
            status: 'SENT',
            timestamp: deliveryStatus.sentAt,
            retry: true
        });

        return res.json({
            success: true,
            message: 'Prescription successfully delivered via Telegram.',
            telegramDelivery: deliveryStatus
        });
    } catch (err: any) {
        console.error('Retry Telegram delivery failed:', err);
        const deliveryStatus = {
            status: 'FAILED',
            triedAt: new Date().toISOString(),
            chatId: authorizedChatId,
            error: err.message || 'Telegram network delivery failed'
        };

        await pRef.update({ telegramDelivery: deliveryStatus });

        await db.collection('telegramDeliveryLogs').add({
            prescriptionId: req.params.id,
            patientId: pData.patientId,
            doctorId: pData.doctorId,
            doctorName: pData.doctorName,
            chatId: authorizedChatId,
            status: 'FAILED',
            error: deliveryStatus.error,
            timestamp: deliveryStatus.triedAt,
            retry: true
        });

        return res.status(502).json({
            success: false,
            message: `Telegram delivery failed: ${deliveryStatus.error}`,
            telegramDelivery: deliveryStatus
        });
    }
});

// POST /api/prescriptions/:id/send-email (DOCTOR, ADMIN, RECEPTIONIST)
router.post('/:id/send-email', authenticate, authorize(['DOCTOR', 'ADMIN', 'RECEPTIONIST']), async (req, res) => {
    const pRef = db.collection('prescriptions').doc(req.params.id);
    const pDoc = await pRef.get();
    if (!pDoc.exists) return res.status(404).json({ message: 'Prescription not found' });
    const pData = pDoc.data()!;

    // Resolve patient details
    const patientDoc = await db.collection('patients').doc(pData.patientId).get();
    const patientData = patientDoc.exists ? patientDoc.data() : {};

    // Target email from request body or existing patient record
    const targetEmail = (req.body.email || patientData?.email || '').trim().toLowerCase();

    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        return res.status(400).json({
            message: 'Please provide a valid recipient email address (e.g. name@domain.com).'
        });
    }

    // Verify PDF file exists, or regenerate if needed
    let filePath = pData.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
        const fileName = pData.fileName || `${pDoc.id}.pdf`;
        filePath = path.join(getPrescriptionDir(), fileName);
        await generatePrescriptionPdf(filePath, {
            prescriptionId: pDoc.id,
            date: pData.createdAt ? pData.createdAt.split('T')[0] : new Date().toISOString().split('T')[0],
            doctorName: pData.doctorName || 'Doctor',
            doctorSpecialization: pData.doctorSpecialization || 'Physician',
            patientName: pData.patientName || patientData?.name || 'Patient',
            patientAge: patientData?.age,
            patientGender: patientData?.gender,
            patientPhone: patientData?.phone,
            patientId: pData.patientId,
            consultationId: pData.consultationId,
            diagnosis: pData.diagnosis || 'Clinical Consultation',
            medications: pData.medications || [],
            instructions: pData.instructions || '',
            followUpDate: pData.followUpDate || ''
        });
        await pRef.update({ filePath, fileName });
    }

    try {
        const consultationDate = pData.createdAt ? pData.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];
        const result = await sendPrescriptionEmail({
            to: targetEmail,
            patientName: pData.patientName,
            patientAge: patientData?.age,
            patientGender: patientData?.gender,
            patientId: pData.patientId,
            doctorName: pData.doctorName,
            doctorSpecialization: pData.doctorSpecialization || 'Physician',
            diagnosis: pData.diagnosis || 'Clinical Consultation',
            medications: pData.medications || [],
            instructions: pData.instructions || '',
            followUpDate: pData.followUpDate || '',
            consultationDate,
            filePath,
            fileName: pData.fileName || `${pDoc.id}.pdf`
        });

        const emailDelivery = {
            status: 'SENT',
            sentAt: new Date().toISOString(),
            recipientEmail: targetEmail,
            messageId: result.messageId
        };

        await pRef.update({ emailDelivery });

        // Update patient record with this email if missing or updated
        if (pData.patientId) {
            await db.collection('patients').doc(pData.patientId).update({
                email: targetEmail,
                updatedAt: new Date().toISOString()
            }).catch(() => {});
        }

        // Log delivery
        await db.collection('emailDeliveryLogs').add({
            prescriptionId: req.params.id,
            patientId: pData.patientId,
            doctorId: req.profile.uid,
            doctorName: req.profile.name || pData.doctorName,
            recipientEmail: targetEmail,
            status: 'SENT',
            messageId: result.messageId,
            timestamp: emailDelivery.sentAt
        });

        return res.json({
            success: true,
            message: `Official prescription PDF successfully delivered to ${targetEmail}.`,
            emailDelivery
        });
    } catch (err: any) {
        console.error('Email prescription delivery failed:', err);
        const emailDelivery = {
            status: 'FAILED',
            triedAt: new Date().toISOString(),
            recipientEmail: targetEmail,
            error: err.message || 'SMTP delivery failed'
        };

        await pRef.update({ emailDelivery });

        await db.collection('emailDeliveryLogs').add({
            prescriptionId: req.params.id,
            patientId: pData.patientId,
            doctorId: req.profile.uid,
            doctorName: req.profile.name || pData.doctorName,
            recipientEmail: targetEmail,
            status: 'FAILED',
            error: emailDelivery.error,
            timestamp: emailDelivery.triedAt
        });

        return res.status(502).json({
            success: false,
            message: `Email delivery failed: ${emailDelivery.error}`,
            emailDelivery
        });
    }
});

export default router;
