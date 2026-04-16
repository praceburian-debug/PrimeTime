import { Redis } from '@upstash/redis';

// Singleton Redis klient – Vercel ho reuse-uje přes warm invocations
export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/*
  Redis key schéma:
    token:{memberId}  → zašifrovaný OAuth token člena
*/

export const KEYS = {
  memberToken: (memberId) => `token:${memberId}`,
};
