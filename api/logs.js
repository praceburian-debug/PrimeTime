import { redis, KEYS, mgetChunked } from '../lib/redis.js';

const ALLOWED = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';
const LOG_TTL = 60*60*24*365*2;

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  // /api/logs/total — cache endpoint pro card-badges
  if (req.method === 'GET' && (req.url||'').includes('/total')) return getTotal(req, res);
  if (req.method === 'POST')   return createLog(req, res);
  if (req.method === 'GET')    return getLogs(req, res);
  if (req.method === 'PATCH')  return updateLog(req, res);
  if (req.method === 'DELETE') return deleteLog(req, res);
  return res.status(405).json({ error: 'Method Not Allowed' });
}

const toMins = (v) => Math.round(Number(v) || 0);
const parseLog = (r) => { try { return typeof r === 'string' ? JSON.parse(r) : (r || null); } catch { return null; } };

// ── GET /api/logs/total?cardId=xxx ────────────────────────
// Čte z Redis cache — žádný výpočet, velmi rychlé
async function getTotal(req, res) {
  const cardId = (req.query||{}).cardId;
  if (!cardId) return res.status(400).json({ error: 'Chybí cardId' });
  const total = await redis.get(KEYS.cardTotal(cardId));
  return res.status(200).json({ total: parseInt(total||0) });
}

async function createLog(req, res) {
  const { memberId, memberName, boardId, boardName, cardId, cardName, cardLabels, mins, desc, date, listName, startedAt, stoppedAt, startHHMM, stopHHMM } = req.body || {};
  if (!memberId || !cardId || !mins) return res.status(400).json({ error: 'Chybí povinná pole' });
  const safeBoardId = boardId || 'unknown';

  const now = Date.now();
  const logId = now.toString(36) + Math.random().toString(36).slice(2,6);
  const log = { id:logId, memberId, memberName, boardId:safeBoardId, boardName:boardName||safeBoardId, cardId, cardName:cardName||cardId, cardLabels:cardLabels||[], mins, desc:desc||'', date:date||new Date().toISOString().slice(0,10), createdAt:new Date(now).toISOString(),
    ...(listName?{listName}:{}),
    ...(startedAt?{startedAt}:{}),
    ...(stoppedAt?{stoppedAt}:{}),
    ...(startHHMM?{startHHMM}:{}),
    ...(stopHHMM?{stopHHMM}:{}),
  };

  // Konstantní počet příkazů bez ohledu na velikost nástěnky (dřív se četly všechny logy nástěnky)
  const p = redis.pipeline();
  p.set(KEYS.log(logId), JSON.stringify(log), { ex: LOG_TTL });
  p.zadd(KEYS.boardLogs(safeBoardId), { score: now, member: logId });
  p.zadd(KEYS.cardLogs(cardId), { score: now, member: logId });
  p.sadd(KEYS.memberLogs(memberId), logId);
  p.sadd(KEYS.boards, safeBoardId);
  p.incrby(KEYS.cardTotal(cardId), toMins(mins));
  await p.exec();

  return res.status(200).json({ ok: true, log });
}

async function getLogs(req, res) {
  const { boardId, memberId, cardId, dateFrom, dateTo } = req.query || {};
  if (!boardId) return res.status(400).json({ error: 'Chybí boardId' });

  let logIds = [];

  if (boardId === 'ALL' && memberId) {
    // Tracker — logy konkrétního člena napříč všemi nástěnkami
    logIds = await redis.smembers(KEYS.memberLogs(memberId)) || [];
  } else if (boardId === 'ALL') {
    // Admin — všechny nástěnky ze setu boards (žádné KEYS skenování celé DB)
    const boardIds = await redis.smembers(KEYS.boards) || [];
    if (boardIds.length) {
      const pipeBatch = redis.pipeline();
      boardIds.forEach(b => pipeBatch.zrange(KEYS.boardLogs(b), 0, -1, { rev: true }));
      const results = await pipeBatch.exec();
      const idSet = new Set();
      results.forEach(r => { if (Array.isArray(r)) r.forEach(id => idSet.add(id)); });
      logIds = [...idSet];
    }
  } else if (cardId) {
    // Popup karty — jen logy této karty, ne celé nástěnky
    logIds = await redis.zrange(KEYS.cardLogs(cardId), 0, -1, { rev: true }) || [];
  } else {
    // Konkrétní nástěnka
    logIds = await redis.zrange(KEYS.boardLogs(boardId), 0, -1, { rev: true }) || [];
  }

  if (!logIds.length) return res.status(200).json({ logs: [] });

  const results = await mgetChunked(logIds.map(KEYS.log));

  let logs = results.map(parseLog).filter(Boolean);

  if (memberId && boardId !== 'ALL') logs = logs.filter(l => l.memberId === memberId);
  if (cardId)   logs = logs.filter(l => l.cardId === cardId);
  if (dateFrom) logs = logs.filter(l => l.date >= dateFrom);
  if (dateTo)   logs = logs.filter(l => l.date <= dateTo);

  return res.status(200).json({ logs });
}

async function updateLog(req, res) {
  const { logId, changes } = req.body || {};
  if (!logId || !changes) return res.status(400).json({ error: 'Chybí logId nebo changes' });

  const log = parseLog(await redis.get(KEYS.log(logId)));
  if (!log) return res.status(404).json({ error: 'Log nenalezen' });

  const allowed = ['desc', 'mins', 'startHHMM', 'stopHHMM', 'startedAt', 'stoppedAt'];
  const update = {};
  allowed.forEach(k => { if (changes[k] !== undefined) update[k] = changes[k]; });

  const updated = { ...log, ...update, updatedAt: new Date().toISOString() };
  const delta = update.mins !== undefined ? toMins(update.mins) - toMins(log.mins) : 0;
  const p = redis.pipeline();
  p.set(KEYS.log(logId), JSON.stringify(updated), { ex: LOG_TTL });
  if (delta) p.incrby(KEYS.cardTotal(log.cardId), delta);
  await p.exec();

  return res.status(200).json({ ok: true, log: updated });
}

async function deleteLog(req, res) {
  const { logId } = req.query || {};
  if (!logId) return res.status(400).json({ error: 'Chybí logId' });

  const log = parseLog(await redis.get(KEYS.log(logId)));
  if (!log) return res.status(404).json({ error: 'Log nenalezen' });

  const p = redis.pipeline();
  p.del(KEYS.log(logId));
  p.zrem(KEYS.boardLogs(log.boardId), logId);
  p.zrem(KEYS.cardLogs(log.cardId), logId);
  p.srem(KEYS.memberLogs(log.memberId), logId);
  p.incrby(KEYS.cardTotal(log.cardId), -toMins(log.mins));
  await p.exec();

  return res.status(200).json({ ok: true });
}
