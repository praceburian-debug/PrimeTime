import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('TOKEN_ENCRYPTION_KEY musí být 64-znakový hex string');
  return Buffer.from(hex, 'hex');
}

/**
 * Zašifruje string (OAuth token) pomocí AES-256-GCM.
 * Vrátí base64 string: iv:authTag:ciphertext
 */
export function encrypt(plaintext) {
  const key = getKey();
  const iv  = randomBytes(12); // 96-bit IV pro GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag   = cipher.getAuthTag();
  return [iv, authTag, encrypted].map(b => b.toString('base64')).join(':');
}

/**
 * Dešifruje string vytvořený funkcí encrypt().
 */
export function decrypt(ciphertext) {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = ciphertext.split(':');
  const iv       = Buffer.from(ivB64,  'base64');
  const authTag  = Buffer.from(tagB64, 'base64');
  const data     = Buffer.from(dataB64,'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(data) + decipher.final('utf8');
}
