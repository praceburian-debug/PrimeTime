/**
 * AES-256-GCM šifrování pomocí Web Crypto API
 * Funguje v Vercel Edge i Node.js runtime
 */

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('TOKEN_ENCRYPTION_KEY musí být 64-znakový hex string');
  const bytes = new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromBase64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

export async function encrypt(plaintext) {
  const key = await getKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // Uložíme iv + ciphertext dohromady oddělené ':'
  return toBase64(iv) + ':' + toBase64(cipherBuf);
}

export async function decrypt(ciphertext) {
  const key = await getKey();
  const [ivB64, dataB64] = ciphertext.split(':');
  const iv   = fromBase64(ivB64);
  const data = fromBase64(dataB64);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plainBuf);
}
