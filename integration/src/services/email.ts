import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions } from 'nodemailer';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

export interface PrescriptionEmailOptions {
  to: string;
  patientName: string;
  patientAge?: number;
  patientGender?: string;
  patientId: string;
  doctorName: string;
  doctorSpecialization?: string;
  diagnosis?: string;
  medications: Array<{
    name: string;
    dosage: string;
    frequency?: string;
    duration: string;
    instructions?: string;
  }>;
  instructions?: string;
  followUpDate?: string;
  consultationDate?: string;
  filePath: string;
  fileName: string;
}

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;

  const rawBrevoKey = (process.env.BREVO_API_KEY || '').trim();
  const host = process.env.SMTP_HOST || (rawBrevoKey.startsWith('xsmtpsib-') ? 'smtp-relay.brevo.com' : undefined);
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS || (rawBrevoKey.startsWith('xsmtpsib-') ? rawBrevoKey : undefined);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (host && user && pass) {
    console.log(`[Email Service] Initializing live SMTP transporter (${host}:${port})...`);
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false
      }
    });
  } else {
    if (rawBrevoKey.startsWith('xsmtpsib-') && !user) {
      console.warn('[Email Service] Detected Brevo SMTP key (xsmtpsib-...). Brevo SMTP also requires your Brevo account email in SMTP_USER in integration/.env.');
    } else {
      console.log('[Email Service] No live SMTP credentials found; using development stream/test transporter.');
    }
    cachedTransporter = nodemailer.createTransport({
      streamTransport: true,
      newline: 'windows',
      buffer: true
    });
  }

  return cachedTransporter;
}

export async function sendPrescriptionEmail(options: PrescriptionEmailOptions): Promise<{
  success: boolean;
  messageId: string;
  previewUrl?: string;
  error?: string;
}> {
  const {
    to,
    patientName,
    patientAge,
    patientGender,
    patientId,
    doctorName,
    doctorSpecialization = 'Physician',
    diagnosis = 'Clinical Consultation',
    medications,
    instructions,
    followUpDate,
    consultationDate = new Date().toISOString().split('T')[0],
    filePath,
    fileName,
  } = options;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Prescription PDF file not found at: ${filePath}`);
  }

  const fromEmail = process.env.SMTP_FROM || 'care@clinicqueue.health';
  const fromName = process.env.SMTP_FROM_NAME || 'OOPS Hospital — ClinicQueue';
  const subject = `Official Medical Prescription — ClinicQueue (Dr. ${doctorName})`;

  const medicationsRowsHtml = medications
    .map(
      (m, idx) => `
      <tr style="border-bottom: 1px solid #e2e8f0; ${idx % 2 === 1 ? 'background-color: #f8fafc;' : ''}">
        <td style="padding: 10px; font-weight: 600; color: #0f172a;">${m.name}</td>
        <td style="padding: 10px; color: #334155;">${m.dosage}</td>
        <td style="padding: 10px; color: #334155;">${m.frequency || '1-0-1'}</td>
        <td style="padding: 10px; color: #334155;">${m.duration}</td>
        <td style="padding: 10px; color: #64748b; font-size: 12px;">${m.instructions || '—'}</td>
      </tr>`
    )
    .join('');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #1e293b;">
  <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #cbd5e1;">
    
    <!-- Top Branding Banner -->
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #0f766e 100%); padding: 24px 28px; color: #ffffff;">
      <h1 style="margin: 0; font-size: 20px; letter-spacing: -0.02em; font-weight: 800;">CLINICQUEUE HEALTHCARE SYSTEM</h1>
      <p style="margin: 4px 0 0 0; font-size: 12px; color: #99f6e4; font-weight: 500;">Multi-Specialty Outpatient Clinic & Diagnostic Care Centre</p>
      <p style="margin: 4px 0 0 0; font-size: 11px; color: #cbd5e1;">100 Medical Enclave, Health City • Tel: +1 (555) 019-2834 • care@clinicqueue.health</p>
    </div>

    <!-- Main Message -->
    <div style="padding: 24px 28px;">
      <p style="font-size: 15px; margin: 0 0 16px 0;">Dear <b>${patientName}</b>,</p>
      <p style="font-size: 13.5px; line-height: 1.5; color: #334155; margin: 0 0 20px 0;">
        Thank you for visiting ClinicQueue. Your clinical consultation with <b>Dr. ${doctorName}</b> has been completed.
        Your official digital prescription PDF document has been securely generated and is attached to this email.
      </p>

      <!-- Consultation Summary Card -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <table style="width: 100%; font-size: 12.5px; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; color: #64748b; width: 35%;">Attending Physician:</td>
            <td style="padding: 4px 0; font-weight: 700; color: #0f172a;">Dr. ${doctorName} (${doctorSpecialization})</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Patient Demographics:</td>
            <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${patientName} ${patientAge ? `(${patientAge} yrs, ${patientGender || '—'})` : ''}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Patient ID:</td>
            <td style="padding: 4px 0; font-family: monospace; font-weight: 700; color: #0f766e;">${patientId}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Consultation Date:</td>
            <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${consultationDate}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Clinical Diagnosis:</td>
            <td style="padding: 4px 0; font-weight: 600; color: #1e3a8a;">${diagnosis}</td>
          </tr>
        </table>
      </div>

      <!-- Prescribed Medications Section -->
      <h3 style="font-size: 14px; margin: 0 0 10px 0; color: #0f172a; text-transform: uppercase; letter-spacing: 0.04em;">Prescribed Medication Schedule</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 20px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
        <thead>
          <tr style="background: #0f766e; color: #ffffff; text-align: left; font-size: 11.5px; text-transform: uppercase;">
            <th style="padding: 10px;">Medication</th>
            <th style="padding: 10px;">Dosage</th>
            <th style="padding: 10px;">Frequency</th>
            <th style="padding: 10px;">Duration</th>
            <th style="padding: 10px;">Instructions</th>
          </tr>
        </thead>
        <tbody>
          ${medicationsRowsHtml}
        </tbody>
      </table>

      ${
        instructions
          ? `
      <div style="background: #f1f5f9; border-left: 4px solid #0f766e; padding: 12px 14px; border-radius: 4px; margin-bottom: 16px;">
        <b style="font-size: 12.5px; color: #0f766e;">Physician Advice & General Instructions:</b>
        <p style="margin: 4px 0 0 0; font-size: 12.5px; color: #334155;">${instructions}</p>
      </div>`
          : ''
      }

      ${
        followUpDate
          ? `
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 14px; border-radius: 6px; margin-bottom: 20px; color: #1e40af; font-size: 12.5px;">
        🗓️ <b>Recommended Follow-up Date:</b> ${followUpDate}
      </div>`
          : ''
      }

      <!-- PDF Attachment Notice -->
      <div style="border: 2px dashed #0f766e; background: #f0fdfa; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px;">
        <div style="font-size: 13.5px; font-weight: 700; color: #0f766e; display: flex; align-items: center; gap: 8px;">
          📎 Official PDF Prescription Attached: <code>${fileName}</code>
        </div>
        <p style="margin: 6px 0 0 0; font-size: 12px; color: #134e4a;">
          Please find your digitally verified prescription attached to this email. You may present this file directly at any certified pharmacy or print it for your medical records.
        </p>
      </div>

      <p style="font-size: 13px; color: #475569; margin: 0;">
        Wishing you a speedy recovery and good health,<br>
        <b>Dr. ${doctorName}</b><br>
        ClinicQueue Healthcare System
      </p>
    </div>

    <!-- Footer -->
    <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 28px; font-size: 11px; color: #64748b; text-align: center;">
      This is a verified electronic prescription issued by ClinicQueue. If you have any medical queries or require immediate assistance, please call our clinic at +1 (555) 019-2834.
    </div>
  </div>
</body>
</html>`;

  const textContent = `
CLINICQUEUE HEALTHCARE SYSTEM
Official Digital Medical Prescription
=====================================

Dear ${patientName},

Your clinical consultation with Dr. ${doctorName} (${doctorSpecialization}) has been completed.
Attached to this email is your official digital prescription PDF (${fileName}).

Consultation Details:
- Attending Physician: Dr. ${doctorName} (${doctorSpecialization})
- Patient Name: ${patientName} (ID: ${patientId}, Age: ${patientAge || '—'}, Gender: ${patientGender || '—'})
- Consultation Date: ${consultationDate}
- Clinical Diagnosis: ${diagnosis}

Prescribed Medications:
${medications.map((m) => `- ${m.name} | Dosage: ${m.dosage} | Frequency: ${m.frequency || '1-0-1'} | Duration: ${m.duration} | Instructions: ${m.instructions || '—'}`).join('\n')}

${instructions ? `General Advice & Instructions: ${instructions}\n` : ''}
${followUpDate ? `Recommended Follow-up: ${followUpDate}\n` : ''}

Attached PDF: ${fileName}
You may present this digital PDF at any authorized pharmacy or print it for your records.

Wishing you good health,
Dr. ${doctorName}
ClinicQueue Healthcare System
Tel: +1 (555) 019-2834
`;

  // 1. Direct Brevo HTTP API dispatch if a REST API key (starts with xkeysib-) is configured
  const rawBrevoKey = (process.env.BREVO_API_KEY || '').trim();
  const isSmtpKey = rawBrevoKey.startsWith('xsmtpsib-');

  if (rawBrevoKey && !isSmtpKey) {
    try {
      console.log(`[Email Service] Sending prescription to ${to} via Brevo HTTP API...`);
      const fileBuffer = fs.readFileSync(filePath);
      const base64Content = fileBuffer.toString('base64');

      const response = await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: fromName, email: fromEmail },
          to: [{ email: to, name: patientName }],
          subject,
          htmlContent,
          textContent,
          attachment: [
            {
              name: fileName,
              content: base64Content,
            },
          ],
        },
        {
          headers: {
            'api-key': rawBrevoKey,
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
          timeout: 20000,
        }
      );

      const messageId = response.data?.messageId || `brevo_${Date.now()}`;
      console.log(`[Email Service] Prescription email sent via Brevo API to ${to}. MessageId: ${messageId}`);
      return {
        success: true,
        messageId,
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Brevo API request failed';
      console.error(`[Email Service] Brevo API delivery error to ${to}:`, errMsg);
      throw new Error(`Brevo Email Error: ${errMsg}`);
    }
  }

  // If user provided an SMTP key (xsmtpsib-...) without setting SMTP_USER
  if (isSmtpKey && !process.env.SMTP_USER) {
    console.warn('[Email Service] Brevo SMTP key provided, but SMTP_USER (your Brevo login email) is missing.');
  }

  // 2. Standard SMTP / Nodemailer delivery
  const transporter = getTransporter();

  const mailOptions: SendMailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text: textContent,
    html: htmlContent,
    attachments: [
      {
        filename: fileName,
        path: filePath,
        contentType: 'application/pdf',
      },
    ],
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    const messageId = info.messageId || `msg_${Date.now()}`;
    console.log(`[Email Service] Prescription email sent to ${to}. MessageId: ${messageId}`);
    return {
      success: true,
      messageId,
    };
  } catch (err: any) {
    console.error(`[Email Service] Failed to send prescription email to ${to}:`, err);
    throw new Error(err.message || 'SMTP transmission failed.');
  }
}
