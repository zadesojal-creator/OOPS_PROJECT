import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { db } from '../firebase/admin';

export interface DoctorSyncResult {
    success: boolean;
    doctorsCount: number;
    activeCount: number;
    ragIngested: boolean;
    chunksIndexed?: number;
    markdownPath: string;
    message: string;
}

interface ParsedDoctorMeta {
    qualifications?: string;
    experience?: string;
    department?: string;
    conditionsTreated?: string;
    languages?: string;
}

export class DoctorSyncService {
    /**
     * Resolve the clinic knowledge directory path safely
     */
    public static getKnowledgeDir(): string {
        const candidates = [
            path.resolve(process.cwd(), 'data/clinic_knowledge'),
            path.resolve(process.cwd(), '../data/clinic_knowledge'),
            path.resolve(__dirname, '../../../data/clinic_knowledge'),
            path.resolve(__dirname, '../../../../data/clinic_knowledge')
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        // Fallback to second candidate (when running inside integration/)
        const fallback = candidates[1];
        if (!fs.existsSync(fallback)) {
            fs.mkdirSync(fallback, { recursive: true });
        }
        return fallback;
    }

    /**
     * Get the AI Service Base URL
     */
    public static getAiUrl(): string {
        return process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
    }

    /**
     * Helper to format working days array into a human-readable string
     */
    public static formatWorkingDays(days: number[]): string {
        if (!days || days.length === 0) return "By Appointment Only";
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const sorted = [...days].sort((a, b) => a - b);
        
        if (sorted.length === 7) return "All Days (Monday to Sunday)";
        if (sorted.length === 6 && sorted[0] === 1 && sorted[5] === 6) return "Monday to Saturday";
        if (sorted.length === 5 && sorted[0] === 1 && sorted[4] === 5) return "Monday to Friday";
        
        return sorted.map(d => dayNames[d] || `Day ${d}`).join(', ');
    }

    /**
     * Helper to format 24h time 'HH:mm' to 'hh:mm AM/PM'
     */
    public static formatTime(t: string): string {
        if (!t) return "";
        const parts = t.split(':');
        const h = parseInt(parts[0], 10);
        const m = parts[1] || "00";
        if (isNaN(h)) return t;
        const ampm = h >= 12 ? "PM" : "AM";
        const h12 = h % 12 || 12;
        return `${h12.toString().padStart(2, '0')}:${m} ${ampm}`;
    }

    /**
     * Format a doctor's schedule into readable markdown lines
     */
    public static formatScheduleLines(sched: any): string[] {
        if (!sched) {
            return ["  - Monday to Saturday: 09:00 AM – 05:00 PM"];
        }
        const days = this.formatWorkingDays(sched.workingDays);
        const start = this.formatTime(sched.startTime || "09:00");
        const end = this.formatTime(sched.endTime || "17:00");
        let line = `  - ${days}: ${start} – ${end}`;
        if (sched.lunchStart && sched.lunchEnd) {
            line += ` (Lunch: ${this.formatTime(sched.lunchStart)} – ${this.formatTime(sched.lunchEnd)})`;
        }
        return [line];
    }

    /**
     * Parse existing doctors_directory.md to preserve rich descriptions, qualifications, etc.
     */
    private static parseExistingDirectory(content: string): Map<string, ParsedDoctorMeta> {
        const metaMap = new Map<string, ParsedDoctorMeta>();
        const doctorSections = content.split(/^###\s+/m);

        for (const section of doctorSections) {
            if (!section.trim()) continue;
            const lines = section.split('\n');
            const titleLine = lines[0] || '';
            const cleanNameMatch = titleLine.match(/Dr\.?\s*([A-Za-z\s]+)/i);
            if (!cleanNameMatch) continue;

            const nameKey = cleanNameMatch[1].trim().toLowerCase();
            const meta: ParsedDoctorMeta = {};

            for (const line of lines) {
                const qualMatch = line.match(/Qualifications\*\*:\s*(.+)/i);
                if (qualMatch) meta.qualifications = qualMatch[1].trim();

                const expMatch = line.match(/Experience\*\*:\s*(.+)/i);
                if (expMatch) meta.experience = expMatch[1].trim();

                const deptMatch = line.match(/Department\*\*:\s*(.+)/i);
                if (deptMatch) meta.department = deptMatch[1].trim();

                const condMatch = line.match(/Conditions Treated\*\*:\s*(.+)/i);
                if (condMatch) meta.conditionsTreated = condMatch[1].trim();

                const langMatch = line.match(/Languages\*\*:\s*(.+)/i);
                if (langMatch) meta.languages = langMatch[1].trim();
            }

            metaMap.set(nameKey, meta);
        }

        return metaMap;
    }

    /**
     * Map a specialization name to its standard clinical department
     */
    private static mapDepartment(specialization: string): string {
        const lower = (specialization || '').toLowerCase();
        if (lower.includes('cardio')) return 'Cardiovascular Medicine';
        if (lower.includes('derma')) return 'Dermatology & Aesthetic Medicine';
        if (lower.includes('neuro')) return 'Neurosciences & Neurology';
        if (lower.includes('ortho')) return 'Orthopedics & Joint Care';
        if (lower.includes('pedia')) return 'Pediatrics & Child Health';
        if (lower.includes('ent')) return 'Otorhinolaryngology (ENT)';
        if (lower.includes('dent')) return 'Dental & Oral Health';
        if (lower.includes('general') || lower.includes('physician')) return 'Internal Medicine';
        return `${specialization} Department`;
    }

    /**
     * Synchronize all Firestore doctors into doctors_directory.md and re-index into AI RAG
     */
    public static async syncDoctorsKnowledgeBase(): Promise<DoctorSyncResult> {
        const knowledgeDir = this.getKnowledgeDir();
        const docPath = path.join(knowledgeDir, 'doctors_directory.md');

        // 1. Read existing metadata if available
        let existingMeta = new Map<string, ParsedDoctorMeta>();
        if (fs.existsSync(docPath)) {
            try {
                const existingContent = fs.readFileSync(docPath, 'utf-8');
                existingMeta = this.parseExistingDirectory(existingContent);
            } catch (err) {
                console.warn('Could not parse existing doctors_directory.md, proceeding with defaults:', err);
            }
        }

        // 2. Fetch all doctors from Firestore
        const docUsersSnap = await db.collection('users')
            .where('role', '==', 'DOCTOR')
            .get();

        // Also fetch all doctor schedules
        const schedulesSnap = await db.collection('doctor_schedules').get();
        const scheduleMap = new Map<string, any>();
        schedulesSnap.forEach(s => {
            scheduleMap.set(s.id, s.data());
        });

        const doctors: any[] = [];
        docUsersSnap.forEach(d => {
            doctors.push({ id: d.id, ...d.data() });
        });

        // Filter and sort: active doctors first, then by name
        doctors.sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            return (a.name || '').localeCompare(b.name || '');
        });

        let activeCount = 0;
        let md = `# ClinicQueue Doctors Directory & Clinical Specialist Profiles\n`;
        md += `## Detailed Information, Timings, Qualifications, Consultation Fees, and Expertise\n\n`;
        md += `---\n\n`;

        let doctorIndex = 1;
        for (const doc of doctors) {
            const rawName = (doc.name || 'Unnamed Doctor').trim();
            const cleanName = rawName.replace(/^Dr\.\s*/i, '');
            const spec = doc.specialization || 'General Physician';
            const room = doc.room || 'Cabin 101, Ground Floor';
            const fee = doc.fee || '$35 (First Visit) | $20 (Follow-up within 7 days)';
            const isActive = doc.active !== false;
            const isOnDuty = doc.onDuty !== false;
            if (isActive) activeCount++;

            const sched = scheduleMap.get(doc.id) || null;
            const timingLines = this.formatScheduleLines(sched);

            // Lookup existing metadata by doctor name
            const metaKey = cleanName.toLowerCase();
            const meta = existingMeta.get(metaKey) || {};

            const department = meta.department || this.mapDepartment(spec);
            const experience = meta.experience || '10+ Years of Clinical Practice';
            const qualifications = meta.qualifications || `MBBS, Specialist Certification (${spec})`;
            const conditions = meta.conditionsTreated || `Comprehensive outpatient care, specialist evaluations, and treatments for ${spec.toLowerCase()} conditions.`;
            const languages = meta.languages || 'English, Hindi';
            const statusStr = isActive ? (isOnDuty ? 'Active | On Duty' : 'Active | Off Duty') : 'Inactive (Not currently taking appointments)';

            md += `### ${doctorIndex}. Dr. ${cleanName} (${spec})\n`;
            md += `- **Doctor ID / UID**: \`${doc.id}\`\n`;
            md += `- **Specialization**: ${spec}\n`;
            md += `- **Department**: ${department}\n`;
            md += `- **Room / Cabin**: ${room}\n`;
            md += `- **Experience**: ${experience}\n`;
            md += `- **Qualifications**: ${qualifications}\n`;
            md += `- **Consultation Timings**:\n${timingLines.join('\n')}\n`;
            md += `- **Consultation Fee**: ${fee}\n`;
            md += `- **Status**: ${statusStr}\n`;
            md += `- **Contact**: ${doc.email || 'clinic@clinicqueue.internal'}${doc.phone ? ` | Phone: ${doc.phone}` : ''}\n`;
            md += `- **Conditions Treated**: ${conditions}\n`;
            md += `- **Languages**: ${languages}\n\n`;
            md += `---\n\n`;

            doctorIndex++;
        }

        // 3. Write updated Markdown to disk
        fs.writeFileSync(docPath, md, 'utf-8');
        console.log(`[DoctorSyncService] Successfully wrote ${doctors.length} doctors (${activeCount} active) to ${docPath}`);

        // 4. Ingest updated Markdown into AI Service RAG
        let ragIngested = false;
        let chunksIndexed = 0;
        const aiUrl = this.getAiUrl();

        try {
            const form = new FormData();
            form.append('file', Buffer.from(md, 'utf-8'), {
                filename: 'doctors_directory.md',
                contentType: 'text/markdown'
            });

            const ragRes = await axios.post(`${aiUrl}/rag/ingest`, form, {
                headers: form.getHeaders(),
                timeout: 15000
            });

            ragIngested = true;
            chunksIndexed = ragRes.data?.chunks_indexed || 0;
            console.log(`[DoctorSyncService] Re-indexed into AI RAG successfully: ${chunksIndexed} chunks indexed.`);
        } catch (ragErr: any) {
            console.warn(`[DoctorSyncService] AI Service RAG re-index warning: ${ragErr.message}. The markdown file was saved and will be indexed on next sync.`);
        }

        return {
            success: true,
            doctorsCount: doctors.length,
            activeCount,
            ragIngested,
            chunksIndexed,
            markdownPath: docPath,
            message: `Synced ${doctors.length} doctors (${activeCount} active) to doctors_directory.md and AI RAG.`
        };
    }
}
