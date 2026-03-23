export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
      
        if (!req.headers['x-telegram-user'] || !req.headers['x-telegram-auth']) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
        
        res.status(200).json({
            apiKey: firebaseConfig.apiKey,
            authDomain: firebaseConfig.authDomain,
            databaseURL: firebaseConfig.databaseURL,
            projectId: firebaseConfig.projectId,
            storageBucket: firebaseConfig.storageBucket,
            messagingSenderId: firebaseConfig.messagingSenderId,
            appId: firebaseConfig.appId,
            measurementId: firebaseConfig.measurementId
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
}
