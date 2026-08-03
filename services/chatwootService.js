import config from '../config/env.js';

async function fetchWithAuth(url, token, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['api_access_token'] = token; // Chatwoot accepts api_access_token in query param or header sometimes; include as header for flexibility

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const fetchImpl = globalThis.fetch && globalThis.fetch.bind(globalThis);
  if (!fetchImpl) throw new Error('No fetch available for chatwootService');

  const res = await fetchImpl(url, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`Chatwoot API error ${res.status}: ${txt}`);
    err.status = res.status;
    throw err;
  }
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function getConversation(accountId, conversationId, apiToken) {
  if (!accountId || !conversationId) return null;
  const base = config.chatwoot?.url || process.env.CHATWOOT_URL || 'https://app.chatwoot.com';
  const url = `${base}/api/v1/accounts/${accountId}/conversations/${conversationId}`;
  return await fetchWithAuth(url, apiToken, 'GET');
}

export async function sendMessageToConversation(accountId, conversationId, apiToken, content) {
  if (!accountId || !conversationId) throw new Error('accountId and conversationId required');
  const base = config.chatwoot?.url || process.env.CHATWOOT_URL || 'https://app.chatwoot.com';
  const url = `${base}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
  // Chatwoot expects { content, message_type: 'outgoing' }
  const body = { content, message_type: 'outgoing' };
  return await fetchWithAuth(url, apiToken, 'POST', body);
}

export async function updateConversation(accountId, conversationId, apiToken, attrs = {}) {
  if (!accountId || !conversationId) throw new Error('accountId and conversationId required');
  const base = config.chatwoot?.url || process.env.CHATWOOT_URL || 'https://app.chatwoot.com';
  const url = `${base}/api/v1/accounts/${accountId}/conversations/${conversationId}`;
  // attrs may include: status, assignee_id, inbox_id, label_ids
  return await fetchWithAuth(url, apiToken, 'PUT', attrs);
}

export async function listInboxConversations(accountId, inboxId, apiToken, params = {}) {
  if (!accountId || !inboxId) return null;
  const base = config.chatwoot?.url || process.env.CHATWOOT_URL || 'https://app.chatwoot.com';
  const url = `${base}/api/v1/accounts/${accountId}/inboxes/${inboxId}/conversations`;
  return await fetchWithAuth(url, apiToken, 'GET');
}

export default { getConversation, sendMessageToConversation, updateConversation, listInboxConversations };