import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { db } from '../firebase/admin';
import { DoctorSyncService } from '../services/DoctorSyncService';
import { getAvailableSpecializations } from '../telegram/workflows/BookingWorkflow';

async function runVerification() {
    console.log('====================================================');
    console.log('🩺 CLINICQUEUE DOCTOR SYNC & AI RAG PIPELINE TEST');
    console.log('====================================================\n');

    let passedTests = 0;
    let failedTests = 0;

    function assert(condition: boolean, testName: string, detail?: string) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passedTests++;
        } else {
            console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
            failedTests++;
        }
    }

    const aiUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
    const testDoctorId = `test_doc_${Date.now()}`;

    try {
        // ----------------------------------------------------
        // STEP 1: Baseline Sync and Verification
        // ----------------------------------------------------
        console.log('--- STEP 1: Verifying Baseline Sync & Knowledge Base ---');
        const syncRes1 = await DoctorSyncService.syncDoctorsKnowledgeBase();
        assert(syncRes1.success === true, 'DoctorSyncService completes successfully');
        assert(syncRes1.ragIngested === true, 'Knowledge base successfully ingested into AI RAG');
        assert(fs.existsSync(syncRes1.markdownPath), 'doctors_directory.md exists on disk');

        const content1 = fs.readFileSync(syncRes1.markdownPath, 'utf-8');
        assert(content1.includes('Dr. Amit Deshmukh'), 'Baseline file includes Dr. Amit Deshmukh');
        assert(content1.includes('Dr. Priya Patel'), 'Baseline file includes Dr. Priya Patel');
        assert(content1.includes('Cabin 204'), 'Baseline file includes Cabin room info');

        // Test AI RAG Query on baseline doctor
        const ragRes1 = await axios.post(`${aiUrl}/rag/query`, {
            question: "What are Dr. Priya Patel's room and consultation timings?"
        });
        assert(!ragRes1.data.insufficient_context, 'RAG retrieves context for Dr. Priya Patel');
        assert(ragRes1.data.answer.includes('Priya Patel') || ragRes1.data.answer.includes('204'), 'RAG answers correctly with Dr. Priya Patel info');

        // ----------------------------------------------------
        // STEP 2: Admin Adds a New Doctor
        // ----------------------------------------------------
        console.log('\n--- STEP 2: Simulating Admin Adding a New Doctor ---');
        const newDoctorData = {
            name: "Sarah Jenkins",
            email: "sarah.jenkins@clinicqueue.internal",
            role: "DOCTOR",
            specialization: "Ophthalmologist",
            room: "Cabin 305, 3rd Floor",
            fee: "$65",
            active: true,
            onDuty: true,
            createdAt: new Date().toISOString()
        };

        await db.collection('users').doc(testDoctorId).set(newDoctorData);
        await db.collection('doctor_schedules').doc(testDoctorId).set({
            doctorId: testDoctorId,
            workingDays: [1, 2, 3, 4, 5],
            startTime: "09:30",
            endTime: "16:30",
            lunchStart: "13:00",
            lunchEnd: "14:00",
            slotDurationMinutes: 20,
            maxAppointments: 20
        });

        // Trigger Auto-Sync (as done by POST /api/admin/users)
        const syncRes2 = await DoctorSyncService.syncDoctorsKnowledgeBase();
        assert(syncRes2.success === true, 'Auto-sync completed after adding doctor');
        assert(syncRes2.ragIngested === true, 'AI RAG re-indexed after adding doctor');

        // Verify doctors_directory.md contains the new doctor
        const content2 = fs.readFileSync(syncRes2.markdownPath, 'utf-8');
        assert(content2.includes('Dr. Sarah Jenkins (Ophthalmologist)'), 'doctors_directory.md updated with Dr. Sarah Jenkins');
        assert(content2.includes('Cabin 305, 3rd Floor'), 'doctors_directory.md contains correct room Cabin 305');
        assert(content2.includes('$65'), 'doctors_directory.md contains correct fee $65');
        assert(content2.includes('Monday to Friday: 09:30 AM – 04:30 PM'), 'doctors_directory.md contains formatted schedule');

        // ----------------------------------------------------
        // STEP 3: Verify AI Service RAG has New Doctor
        // ----------------------------------------------------
        console.log('\n--- STEP 3: Verifying AI Service RAG for New Doctor ---');
        const ragRes2 = await axios.post(`${aiUrl}/rag/query`, {
            question: "Who is Dr. Sarah Jenkins and what is her cabin and fee?"
        });
        assert(!ragRes2.data.insufficient_context, 'RAG successfully found context for Dr. Sarah Jenkins');
        assert(ragRes2.data.answer.toLowerCase().includes('sarah') || ragRes2.data.answer.includes('305'), 'RAG answers query regarding new doctor Dr. Sarah Jenkins');

        // ----------------------------------------------------
        // STEP 4: Admin Updates Doctor Information
        // ----------------------------------------------------
        console.log('\n--- STEP 4: Simulating Admin Updating Doctor Information ---');
        await db.collection('users').doc(testDoctorId).update({
            room: "Cabin 412, VIP Wing",
            fee: "$80",
            specialization: "Senior Eye Surgeon"
        });

        const syncRes3 = await DoctorSyncService.syncDoctorsKnowledgeBase();
        assert(syncRes3.success === true, 'Auto-sync completed after updating doctor');

        const content3 = fs.readFileSync(syncRes3.markdownPath, 'utf-8');
        assert(content3.includes('Cabin 412, VIP Wing'), 'doctors_directory.md reflects updated room Cabin 412');
        assert(content3.includes('$80'), 'doctors_directory.md reflects updated fee $80');
        assert(content3.includes('Senior Eye Surgeon'), 'doctors_directory.md reflects updated specialization');

        // ----------------------------------------------------
        // STEP 5: Verify Dynamic Telegram Booking & Listing
        // ----------------------------------------------------
        console.log('\n--- STEP 5: Verifying Dynamic Telegram Specializations & Doctor Query ---');
        const specs = await getAvailableSpecializations();
        assert(specs.includes('Senior Eye Surgeon'), 'Telegram getAvailableSpecializations includes new doctor specialization');

        // Verify live query matches new doctor
        const activeDocsSnap = await db.collection('users')
            .where('role', '==', 'DOCTOR')
            .where('active', '==', true)
            .get();
        const found = activeDocsSnap.docs.some(d => d.id === testDoctorId && d.data().name === 'Sarah Jenkins');
        assert(found === true, 'Telegram active doctor query immediately finds new doctor');

    } finally {
        // ----------------------------------------------------
        // CLEANUP: Remove test doctor and restore directory
        // ----------------------------------------------------
        console.log('\n--- CLEANUP: Removing test doctor and restoring knowledge base ---');
        try {
            await db.collection('users').doc(testDoctorId).delete();
            await db.collection('doctor_schedules').doc(testDoctorId).delete();
            await DoctorSyncService.syncDoctorsKnowledgeBase();
            console.log('  Cleaned up temporary test doctor and restored directory.');
        } catch (cleanupErr) {
            console.warn('  Cleanup warning:', cleanupErr);
        }
    }

    console.log('\n====================================================');
    console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('====================================================');

    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runVerification().catch(err => {
    console.error('Fatal error during verification:', err);
    process.exit(1);
});
