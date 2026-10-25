import * as admin from 'firebase-admin';

// Initialize Firebase Admin using default credentials.
// The GOOGLE_APPLICATION_CREDENTIALS environment variable must point
// to the service account JSON key file.
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
db.settings({ preferRest: true, ignoreUndefinedProperties: true });

export { db };
export const auth = admin.auth();

// We map document references to plain objects to match the old C++ API behavior.
// Specifically, appending the document ID as 'id' and keeping 'createdAt' strings.
export const formatDoc = (doc: admin.firestore.DocumentSnapshot) => {
    if (!doc.exists) return null;
    const data = doc.data() as any;
    data.id = doc.id;
    return data;
};
