/**
 * Docházka — dřív v Trello member/private (limit 4096 znaků, sdílený s časovačem).
 *
 * GET /api/attendance?memberId=xxx[&boardId=yyy] → { records }  (Můj report)
 * GET /api/attendance?boardId=xxx    → { summaries }             (admin report, tvar jako pt-att-summaries)
 * PUT /api/attendance { memberId, memberName, boardId, records }  → uloží celou docházku člena
 */

import { redis, KEYS, mgetChunked } from '../lib/redis.js';

const ALLOWED = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET' && (req.query||{}).memberId) return getMember(req, res);
    if (req.method === 'GET' && (req.query||{}).boardId)  return getBoard(req, res);
    if (req.method === 'PUT') return save(req, res);
    return res.status(400).json({ error: 'Chybí memberId nebo boardId' });
  } catch (e) {
    console.error('attendance error:', e);
    return res.status(500).json({ error: e.message });
  }
}

const parse = (r) => { try { return typeof r === 'string' ? JSON.parse(r) : (r || null); } catch { return null; } };

function attMins(r) {
  if (!r.arrival || !r.departure) return null;
  const [ah, am] = r.arrival.split(':').map(Number);
  const [dh, dm] = r.departure.split(':').map(Number);
  return Math.max(0, (dh*60+dm) - (ah*60+am) - (r.lunch||0));
}

// S boardId zároveň zařadí člena s docházkou do admin reportu nástěnky
// (dřív to dělalo otevření záložky Docházka přes pt-att-summaries)
async function getMember(req, res) {
  const { memberId, boardId } = req.query;
  const att = parse(await redis.get(KEYS.attendance(memberId)));
  if (boardId && att?.records?.length) await redis.sadd(KEYS.boardAttendance(boardId), memberId);
  return res.status(200).json({ records: att?.records || [] });
}

async function getBoard(req, res) {
  const memberIds = await redis.smembers(KEYS.boardAttendance(req.query.boardId)) || [];
  if (!memberIds.length) return res.status(200).json({ summaries: {} });

  const raws = await mgetChunked(memberIds.map(KEYS.attendance));
  const summaries = {};
  raws.forEach((raw, i) => {
    const att = parse(raw);
    if (!att) return;
    const summary = {}, records = {};
    (att.records || []).forEach(r => {
      if (!r.date) return;
      const month = r.date.slice(0, 7), mins = attMins(r);
      if (mins) summary[month] = (summary[month]||0) + mins;
      (records[month] ||= []).push({ date:r.date, arrival:r.arrival||'', departure:r.departure||'', lunch:r.lunch||0, mins:mins||0 });
    });
    summaries[memberIds[i]] = { memberName: att.memberName || '', summary, records, updatedAt: att.updatedAt };
  });
  return res.status(200).json({ summaries });
}

async function save(req, res) {
  const { memberId, memberName, boardId, records } = req.body || {};
  if (!memberId || !Array.isArray(records)) return res.status(400).json({ error: 'Chybí memberId nebo records' });

  const p = redis.pipeline();
  p.set(KEYS.attendance(memberId), JSON.stringify({ memberName: memberName||'', records, updatedAt: new Date().toISOString() }));
  if (boardId) p.sadd(KEYS.boardAttendance(boardId), memberId);
  await p.exec();
  return res.status(200).json({ ok: true });
}
