export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    try {
        
        const userId = req.headers['x-user-id'];
        const telegramHash = req.headers['x-telegram-hash'];
        
        if (!userId || !telegramHash) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const { action, params } = req.body;
        const BOT_TOKEN = process.env.BOT_TOKEN;
        
        let endpoint = '';
        switch(action) {
            case 'getChatMember':
                endpoint = 'getChatMember';
                break;
            case 'getChatAdministrators':
                endpoint = 'getChatAdministrators';
                break;
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
        
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        
        const data = await response.json();
        res.status(200).json(data);
        
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
}
