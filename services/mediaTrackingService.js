import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';

let clientOverride = null;
const PENDING_TTL_MS = Number(process.env.MEDIA_SEND_PENDING_TTL_MS || 10 * 60 * 1000);

export function initMediaTrackingClient(client) {
  clientOverride = client;
}

function getClient() {
  if (clientOverride) return clientOverride;
  const url = config.supabase?.url || process.env.SUPABASE_URL;
  const key = config.supabase?.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return null;
  clientOverride = createClient(url, key);
  return clientOverride;
}

/**
 * Claims one logical send. The unique constraint in Supabase makes this safe
 * when two webhook deliveries for the same message run concurrently.
 */
export async function claimMediaSend({ recipient, imageKey, campaignKey = 'catalog' } = {}) {
  const supabase = getClient();
  if (!supabase || !recipient || !imageKey) return { claimed: true, persistent: false };
  const payload = {
    recipient: String(recipient),
    image_key: String(imageKey),
    campaign_key: String(campaignKey),
    status: 'pending',
    updated_at: new Date().toISOString(),
  };
  try {
    const { data, error } = await supabase
      .from('whatsapp_media_sends')
      .insert(payload)
      .select('id,status,updated_at')
      .maybeSingle();
    if (!error && data) return { claimed: true, persistent: true, id: data.id };

    const { data: existing } = await supabase
      .from('whatsapp_media_sends')
      .select('id,status,updated_at')
      .eq('recipient', payload.recipient)
      .eq('image_key', payload.image_key)
      .eq('campaign_key', payload.campaign_key)
      .maybeSingle();
    if (!existing) return { claimed: true, persistent: true };
    if (existing.status === 'sent') return { claimed: false, persistent: true, alreadySent: true };
    const stale = Date.now() - new Date(existing.updated_at || 0).getTime() > PENDING_TTL_MS;
    if (!stale) return { claimed: false, persistent: true, inProgress: true };
    const { data: reclaimed } = await supabase
      .from('whatsapp_media_sends')
      .update(payload)
      .eq('id', existing.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    return { claimed: Boolean(reclaimed), persistent: true, id: existing.id };
  } catch (error) {
    // Tracking must never prevent the normal webhook response.
    console.warn('[mediaTracking] claim failed:', error?.message || error);
    return { claimed: true, persistent: false };
  }
}

export async function completeMediaSend(id, status = 'sent', errorMessage = null) {
  const supabase = getClient();
  if (!supabase || !id) return;
  const update = { status, updated_at: new Date().toISOString() };
  if (errorMessage) update.error_message = String(errorMessage).slice(0, 500);
  try {
    await supabase.from('whatsapp_media_sends').update(update).eq('id', id);
  } catch (error) {
    console.warn('[mediaTracking] completion failed:', error?.message || error);
  }
}

export async function sendCampaignWelcome({ recipient, send, campaignKey = 'welcome' } = {}) {
  const claim = await claimMediaSend({ recipient, imageKey: '__welcome__', campaignKey });
  if (!claim.claimed) return { sent: false, alreadySent: Boolean(claim.alreadySent) };
  try {
    const result = await send();
    await completeMediaSend(claim.id, 'sent');
    return { sent: true, result };
  } catch (error) {
    await completeMediaSend(claim.id, 'failed', error?.message || error);
    throw error;
  }
}

export default { claimMediaSend, completeMediaSend, sendCampaignWelcome, initMediaTrackingClient };
