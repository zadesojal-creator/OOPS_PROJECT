import express from 'express';
import cors from 'cors';
import 'express-async-errors';
import dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

// Route imports
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import patientRoutes from './routes/patients';
import queueRoutes from './routes/queue';
import consultationRoutes from './routes/consultations';
import prescriptionRoutes from './routes/prescriptions';
import doctorRoutes from './routes/doctors';
import appointmentRoutes from './routes/appointments';
import faqRoutes from './routes/faq';
import telegramRoutes from './routes/telegram';
import patientPortalRoutes from './routes/patientPortal';

// Telegram Bot
import { initializeBot, getBot } from './telegram/bot';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Public health checks
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'Node.js Integration API' });
});

app.get('/api/health/system', async (req, res) => {
    let ragOnline = false;
    try {
        const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
        const aiRes = await axios.get(`${aiUrl}/health`, { timeout: 2000 });
        if (aiRes.status === 200 && aiRes.data && aiRes.data.ok) {
            ragOnline = true;
        }
    } catch {
        ragOnline = false;
    }
    const telegramOnline = !!getBot();
    res.json({
        telegram: telegramOnline,
        rag: ragOnline,
        engine: true,
        node: true,
    });
});

// Routes
app.use('/api', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api', doctorRoutes); 
app.use('/api/appointments', appointmentRoutes);
app.use('/api', faqRoutes); 
app.use('/api/telegram', telegramRoutes);
app.use('/api/patient-portal', patientPortalRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Internal Server Error' });
});

// Start the server if this file is run directly
if (require.main === module) {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`Node.js API listening on port ${port}`);
        
        // Start Telegram Bot Polling
        const bot = initializeBot();
        if (bot) {
            console.log('Telegram Bot initialized and polling...');
        }
    });
}

export default app;
