/**
 * POST /api/send-comment
 * QStash zavolá tento endpoint v naplánovaný čas
 */

import { Receiver }    from '@upstash/qstash';
import { redis, KEYS } from '../lib/redis.js';
import { decrypt }     from '../lib/crypto.js';
import { postComment } from '../lib/trello.js';

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey:    process.env.QSTASH_NEXT_SIGNING_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Ověř QStash podpis
  const rawBody  = JSON.stringify(req.body);
  const signature = req.headers['upstash-signature'] || '';

  let isValid = false;
  try {
    isValid = await receiver.verify({ signature, body: rawBody, clockTolerance: 5 });
  } catch (err) {
    console.error('QStash verify error:', err);
  }
  if (!isValid) return res.status(401).json({ error: 'Invalid QStash signature' });

  const { jobId, memberId, cardId } = req.body || {};
  if (!jobId || !memberId || !cardId) return res.status(400).json({ error: 'Chybí pole' });

  // Načti job
  const jobRaw = await redis.get(KEYS.job(jobId));
  if (!jobRaw) {
    console.warn(`Job ${jobId} nenalezen — pravděpodobně zrušen`);
    return res.status(200).json({ ok: true, skipped: true });
  }
  const job = typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw;
  if (job.status === 'cancelled') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  // Načti a dešifruj token
  const encryptedToken = await redis.get(KEYS.memberToken(memberId));
  if (!encryptedToken) {
    await redis.set(KEYS.job(jobId), JSON.stringify({ ...job, status: 'failed', failReason: 'Token odvolán' }), { ex: 48 * 3600 });
    return res.status(200).json({ ok: true, skipped: true });
  }

  let memberToken;
  try {
    memberToken = await decrypt(String(encryptedToken));
  } catch (err) {
    console.error('Decrypt error:', err);
    return res.status(200).json({ error: 'Decryption failed' });
  }

  // Odešli komentář
  try {
    await postComment(cardId, job.text, memberToken);
    await redis.set(KEYS.job(jobId), JSON.stringify({ ...job, status: 'sent', sentAt: new Date().toISOString() }), { ex: 48 * 3600 });
    await redis.srem(KEYS.memberJobs(memberId), jobId);
    console.log(`✓ Job ${jobId} odeslán`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`Chyba odesílání job ${jobId}:`, err);
    await redis.set(KEYS.job(jobId), JSON.stringify({ ...job, status: 'failed', failReason: err.message }), { ex: 48 * 3600 });
    return res.status(500).json({ error: err.message }); // 500 = QStash retry
  }
}
