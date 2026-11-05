import { Redis } from '@upstash/redis';

// Singleton Redis klient – Vercel ho reuse-uje přes warm invocations
export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/*
  Redis key schéma:
    token:{memberId}        → zašifrovaný OAuth token člena
    log:{logId}             → JSON jednoho záznamu (TTL 2 roky)
    board-logs:{boardId}    → ZSET logId (score = createdAt ms)
    card-logs:{cardId}      → ZSET logId (score = createdAt ms)
    member-logs:{memberId}  → SET logId
    card-total:{cardId}     → součet minut karty (udržovaný přes INCRBY)
    boards                  → SET všech boardId s logy (místo KEYS board-logs:*)
    att:{memberId}          → JSON docházky člena { memberName, records, updatedAt }
    att-board:{boardId}     → SET memberId, kteří vedou docházku na nástěnce (admin report)
*/

export const KEYS = {
  memberToken: (memberId) => `token:${memberId}`,
  log:         (logId)    => `log:${logId}`,
  boardLogs:   (boardId)  => `board-logs:${boardId}`,
  cardLogs:    (cardId)   => `card-logs:${cardId}`,
  memberLogs:  (memberId) => `member-logs:${memberId}`,
  cardTotal:   (cardId)   => `card-total:${cardId}`,
  boards:      'boards',
  attendance:      (memberId) => `att:${memberId}`,
  boardAttendance: (boardId)  => `att-board:${boardId}`,
};

// MGET po dávkách — jeden příkaz na 500 klíčů místo jednoho GETu na klíč
export async function mgetChunked(keys, size = 500) {
  const out = [];
  for (let i = 0; i < keys.length; i += size) {
    out.push(...await redis.mget(...keys.slice(i, i + size)));
  }
  return out;
}
