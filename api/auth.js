/**
 * POST /api/auth
 * Uloží OAuth token člena — zašifrovaně do Redis
 */

import { redis, KEYS } from '../lib/redis.js';
import { encrypt }     from '../lib/crypto.js';
import { getMember }   from '../lib/trello.js';

export default async function handler(req, res) {
  // CORS
  const allowed = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  const { memberId, token } = req.body || {};
  if (!memberId || !token) return res.status(400).json({ error: 'Chybí memberId nebo token' });

  try {
    const member = await getMember(token);
    if (member.id !== memberId) return res.status(403).json({ error: 'Token nepatří tomuto členovi' });

    const encrypted = await encrypt(token);
    await redis.set(KEYS.memberToken(memberId), encrypted, { ex: 60 * 60 * 24 * 365 });

    return res.status(200).json({ ok: true, memberName: member.fullName });
  } catch (err) {
    console.error('auth error:', err);
    return res.status(500).json({ error: err.message });
  }
}
