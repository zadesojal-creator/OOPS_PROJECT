import { db } from '../firebase/admin';

async function check() {
    const aptsSnap = await db.collection('appointments').get();
    const docMap = new Map<string, number>();
    aptsSnap.forEach(d => {
        const a = d.data();
        docMap.set(a.doctorId, (docMap.get(a.doctorId) || 0) + 1);
    });
    console.log('Appointments per doctorId:', Object.fromEntries(docMap));

    // Also check queue doc doctorIds
    const queueSnap = await db.collection('queue').get();
    queueSnap.forEach(d => {
        console.log('Queue item:', d.id, d.data().tokenNumber, 'doctorId:', d.data().doctorId, 'status:', d.data().status);
    });

    process.exit(0);
}
check();
