import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import axios from 'axios';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { db } from '../firebase/admin';
import { DoctorSyncService } from '../services/DoctorSyncService';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 11 * 1024 * 1024 } });

function getAiUrl() {
    return process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
}

// GET /api/admin/rag/documents
router.get('/admin/rag/documents', authenticate, authorize(['ADMIN']), async (req, res) => {
    try {
        const response = await axios.get(`${getAiUrl()}/rag/documents`, { timeout: 15000 });
        res.json(response.data);
    } catch (e: any) {
        res.status(502).json({ message: `FAQ document service is unavailable: ${e.message}` });
    }
});

// POST /api/admin/rag/ingest
router.post('/admin/rag/ingest', authenticate, authorize(['ADMIN']), upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Upload a PDF, text, or Markdown file using multipart form data' });
    }

    try {
        const formData = new FormData();
        formData.append('file', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });

        const response = await axios.post(`${getAiUrl()}/rag/ingest`, formData, {
            headers: formData.getHeaders(),
            timeout: 30000
        });

        res.status(201).json(response.data);
    } catch (e: any) {
        if (e.response && e.response.status >= 400 && e.response.status < 500) {
            return res.status(e.response.status).json(e.response.data);
        }
        res.status(502).json({ message: `FAQ document service is unavailable: ${e.message}` });
    }
});

// POST /api/admin/rag/sync-knowledge (One-click sync of hospital information & doctor profiles into RAG)
router.post('/admin/rag/sync-knowledge', authenticate, authorize(['ADMIN']), async (req, res) => {
    try {
        const results = [];
        const baseDir = DoctorSyncService.getKnowledgeDir();

        // 1. Ingest hospital_information.md if present
        const hospitalFile = path.join(baseDir, 'hospital_information.md');
        if (fs.existsSync(hospitalFile)) {
            const buf = fs.readFileSync(hospitalFile);
            const form1 = new FormData();
            form1.append('file', buf, { filename: 'hospital_information.md', contentType: 'text/markdown' });
            const r1 = await axios.post(`${getAiUrl()}/rag/ingest`, form1, { headers: form1.getHeaders(), timeout: 30000 });
            results.push(r1.data);
        }

        // 2. Sync doctor directory and ingest into RAG
        const docSyncRes = await DoctorSyncService.syncDoctorsKnowledgeBase();
        results.push(docSyncRes);

        res.json({
            success: true,
            message: 'Hospital information and doctor profiles successfully synced to AI RAG knowledge base.',
            indexed_documents: results
        });
    } catch (e: any) {
        console.error('Error syncing clinic knowledge to RAG:', e);
        res.status(502).json({ message: `Sync failed: ${e.message}` });
    }
});

// POST /api/admin/rag/doctor-profile (Upload or update an individual doctor's profile in RAG)
router.post('/api/admin/rag/doctor-profile', authenticate, authorize(['ADMIN']), async (req, res) => {
    const { doctorName, specialization, timings, fee, room, bio, qualifications, experience } = req.body;
    if (!doctorName) return res.status(400).json({ message: 'doctorName is required' });

    try {
        const docContent = `# Doctor Profile: Dr. ${doctorName}\n` +
            `- **Doctor Name**: Dr. ${doctorName}\n` +
            `- **Specialization**: ${specialization || 'Specialist'}\n` +
            `- **Room / Cabin**: ${room || 'OPD Cabin'}\n` +
            `- **Qualifications**: ${qualifications || 'MBBS, MD'}\n` +
            `- **Experience**: ${experience || 'Experienced Clinical Specialist'}\n` +
            `- **Consultation Timings**: ${timings || 'Monday to Saturday 10:00 AM - 02:00 PM'}\n` +
            `- **Consultation Fee**: ${fee || '$40'}\n` +
            `- **Clinical Expertise**: ${bio || 'General & specialized outpatient medical care.'}\n`;

        const filename = `doctor_${doctorName.toLowerCase().replace(/[^a-z0-9]/g, '_')}.md`;
        const form = new FormData();
        form.append('file', Buffer.from(docContent, 'utf-8'), { filename, contentType: 'text/markdown' });

        const response = await axios.post(`${getAiUrl()}/rag/ingest`, form, { headers: form.getHeaders(), timeout: 30000 });
        res.status(201).json({ success: true, filename, result: response.data });
    } catch (e: any) {
        res.status(502).json({ message: `Failed to upload doctor profile: ${e.message}` });
    }
});

// POST /api/ai/rag/query
router.post('/ai/rag/query', authenticate, authorize(['ADMIN', 'DOCTOR']), async (req, res) => {
    const { question } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length === 0 || question.length > 2000) {
        return res.status(400).json({ message: 'A question of at most 2000 characters is required' });
    }

    try {
        const response = await axios.post(`${getAiUrl()}/rag/query`, { question }, { timeout: 15000 });
        res.json(response.data);
    } catch (e: any) {
        res.status(502).json({ message: `AI retrieval service is unavailable: ${e.message}` });
    }
});

export default router;
