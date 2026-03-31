import { redis } from '../lib/redis.js';

const ALLOWED = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).end();

  const cardId = (req.query||{}).cardId;
  if (!cardId) return res.status(400).json({ error: 'Chybí cardId' });

  try {
    const total = await redis.get('card-total:' + cardId);
    return res.status(200).json({ total: parseInt(total||0) });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
