const TRELLO_BASE = 'https://api.trello.com/1';

/**
 * Zavolá Trello REST API s OAuth tokenem konkrétního člena.
 */
async function trelloRequest(method, path, token, body = null) {
  const url = new URL(`${TRELLO_BASE}${path}`);
  url.searchParams.set('key',   process.env.TRELLO_API_KEY);
  url.searchParams.set('token', token);

  const res = await fetch(url.toString(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body:    body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trello API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Odešle komentář na kartu jménem člena jehož token předáváme.
 */
export async function postComment(cardId, text, memberToken) {
  return trelloRequest('POST', `/cards/${cardId}/actions/comments`, memberToken, { text });
}

/**
 * Ověří token — vrátí info o členovi nebo vyhodí chybu.
 */
export async function getMember(memberToken) {
  return trelloRequest('GET', '/members/me', memberToken);
}
