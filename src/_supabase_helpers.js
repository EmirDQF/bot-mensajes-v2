export async function persistSessionToSupabase(supabase, sessionId, sessionEntry, ttlMs) {
  if (!supabase) return;
  try {
    const payload = {
      id: sessionId,
      history: JSON.stringify(sessionEntry.history || []),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    };

    await supabase.from('chat_sessions').upsert(payload, { onConflict: 'id' });
  } catch (e) {
    console.warn('persistSessionToSupabase failed:', e?.message || e);
  }
}

export async function loadSessionFromSupabase(supabase, sessionId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from('chat_sessions').select('history,expires_at,updated_at').eq('id', sessionId).maybeSingle();
    if (error) {
      console.warn('loadSessionFromSupabase error:', error.message || error);
      return null;
    }
    if (!data) return null;
    let history = [];
    try {
      history = JSON.parse(data.history || '[]');
    } catch (e) {
      console.warn('Failed parsing session history from supabase:', e?.message || e);
      history = [];
    }
    return { history, expires_at: data.expires_at, updated_at: data.updated_at };
  } catch (e) {
    console.warn('loadSessionFromSupabase failed:', e?.message || e);
    return null;
  }
}
