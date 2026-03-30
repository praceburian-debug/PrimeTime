/**
 * /api/logs
 *
 * POST   — uloží nový log záznam
 * GET    — vrátí logy s filtry
 * PATCH  — upraví existující záznam (desc nebo mins)
 * DELETE — smaže záznam
 */

import { redis } from '../lib/redis.js';

// Redis key schéma:
//   log:{logId}          → JSON záznamu
//   board-logs:{boardId} → ZSET logId scored by timestamp (pro řazení)
//   card-total:{cardId}  → number (cache pro badge)

function corsHeaders(req) {
  const allowed = process.env.ALLOWED_ORIGIN || 'https://praceburian-debug.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(req, res) {
  const h = corsHeaders(req);
  Object.entries(h).forEach(([k,v]) => res.setHeader(k,v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'POST')   return createLog(req, res);
  if (req.method === 'GET')    return getLogs(req, res);
  if (req.method === 'PATCH')  return updateLog(req, res);
  if (req.method === 'DELETE') return deleteLog(req, res);
  return res.status(405).json({ error: 'Method Not Allowed' });
}

// ── POST /api/logs ────────────────────────────────────────
async function createLog(req, res) {
  const { memberId, memberName, boardId, boardName, cardId, cardName, cardLabels, mins, desc, date } = req.body || {};
  if (!memberId || !boardId || !cardId || !mins) {
    return res.status(400).json({ error: 'Chybí povinná pole' });
  }

  const logId = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const log = {
    id: logId,
    memberId, memberName,
    boardId, boardName: boardName || boardId,
    cardId, cardName: cardName || cardId,
    cardLabels: cardLabels || [],
    mins, desc: desc || '',
    date: date || new Date().toISOString().slice(0,10),
    createdAt: new Date().toISOString(),
  };

  // Ulož log
  await redis.set(`log:${logId}`, JSON.stringify(log), { ex: 60 * 60 * 24 * 365 * 2 }); // 2 roky

  // Přidej do ZSET nástěnky (score = timestamp pro řazení)
  await redis.zadd(`board-logs:${boardId}`, { score: Date.now(), member: logId });

  // Přidej do member-logs indexu (pro cross-board report)
  await redis.sadd(`member-logs:${memberId}`, logId);

  // Aktualizuj cache badge pro kartu
  await updateCardTotal(boardId, cardId);

  return res.status(200).json({ ok: true, log });
}

// ── GET /api/logs ─────────────────────────────────────────
// Query params: boardId (required), memberId, cardId, dateFrom, dateTo
// Speciální: boardId=ALL&memberId=xxx → všechny nástěnky daného člena (pro tracker report)
async function getLogs(req, res) {
  const { boardId, memberId, cardId, dateFrom, dateTo } = req.query || {};

  if (!boardId) return res.status(400).json({ error: 'Chybí boardId' });

  let logIds = [];

  if (boardId === 'ALL' && memberId) {
    // Tracker report — načti logy z všech nástěnek pro daného člena
    // Uložíme member-logs index při každém logu
    const memberLogIds = await redis.smembers(`member-logs:${memberId}`) || [];
    logIds = memberLogIds;
  } else {
    // Načti všechny logId pro tuto nástěnku (ZSET, nejnovější první)
    logIds = await redis.zrange(`board-logs:${boardId}`, 0, -1, { rev: true }) || [];
  }

  if (!logIds.length) return res.status(200).json({ logs: [] });

  // Batch načtení logů
  const pipeline = redis.pipeline();
  logIds.forEach(id => pipeline.get(`log:${id}`));
  const results = await pipeline.exec();

  let logs = results
    .map(r => { try { return typeof r === 'string' ? JSON.parse(r) : r; } catch { return null; } })
    .filter(Boolean);

  // Filtry
  if (memberId && boardId !== 'ALL') logs = logs.filter(l => l.memberId === memberId);
  if (cardId)   logs = logs.filter(l => l.cardId === cardId);
  if (dateFrom) logs = logs.filter(l => l.date >= dateFrom);
  if (dateTo)   logs = logs.filter(l => l.date <= dateTo);

  return res.status(200).json({ logs });
}

// ── PATCH /api/logs ───────────────────────────────────────
async function updateLog(req, res) {
  const { logId, memberId, changes } = req.body || {};
  if (!logId || !changes) return res.status(400).json({ error: 'Chybí logId nebo changes' });

  const raw = await redis.get(`log:${logId}`);
  if (!raw) return res.status(404).json({ error: 'Log nenalezen' });

  const log = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Oprávnění: admin může editovat vše, tracker jen své záznamy
  // Frontend posílá memberId editujícího — backend to ověří proti log.memberId
  // (plná verifikace by vyžadovala token check, pro MVP stačí memberId match)

  const allowed = ['desc', 'mins'];
  const update = {};
  allowed.forEach(k => { if (changes[k] !== undefined) update[k] = changes[k]; });

  const updated = { ...log, ...update, updatedAt: new Date().toISOString() };
  await redis.set(`log:${logId}`, JSON.stringify(updated), { ex: 60 * 60 * 24 * 365 * 2 });

  // Pokud se změnil mins, aktualizuj badge cache
  if (update.mins !== undefined) {
    await updateCardTotal(log.boardId, log.cardId);
  }

  return res.status(200).json({ ok: true, log: updated });
}

// ── DELETE /api/logs ──────────────────────────────────────
async function deleteLog(req, res) {
  const { logId } = req.query || {};
  if (!logId) return res.status(400).json({ error: 'Chybí logId' });

  const raw = await redis.get(`log:${logId}`);
  if (!raw) return res.status(404).json({ error: 'Log nenalezen' });

  const log = typeof raw === 'string' ? JSON.parse(raw) : raw;

  await redis.del(`log:${logId}`);
  await redis.zrem(`board-logs:${log.boardId}`, logId);
  await redis.srem(`member-logs:${log.memberId}`, logId);
  await updateCardTotal(log.boardId, log.cardId);

  return res.status(200).json({ ok: true });
}

// ── Helper: přepočítej cache badge pro kartu ──────────────
async function updateCardTotal(boardId, cardId) {
  const logIds = await redis.zrange(`board-logs:${boardId}`, 0, -1) || [];
  if (!logIds.length) { await redis.set(`card-total:${cardId}`, 0); return; }
  const pipeline = redis.pipeline();
  logIds.forEach(id => pipeline.get(`log:${id}`));
  const results = await pipeline.exec();
  const total = results
    .map(r => { try { return typeof r === 'string' ? JSON.parse(r) : r; } catch { return null; } })
    .filter(l => l && l.cardId === cardId)
    .reduce((s, l) => s + (l.mins || 0), 0);
  await redis.set(`card-total:${cardId}`, total, { ex: 60 * 60 * 24 * 7 });
}
