require('dotenv').config();
/**
 * BOT MONITOR — CQPHARMA
 * Backend API - Strict Read-Only Mode for WhatsApp Bot Monitoring
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for cross-origin requests
app.use(cors());
app.use(express.json());

// Validate Supabase environment variables
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
} else {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Database endpoints will return fallback state.');
}

// Helper: try multiple table names and column mappings to fetch and normalize messages
const possibleMessageTables = ['messages', 'mensajes', 'chat_logs'];
const possibleIdColumns = ['conversation_id', 'chat_id', 'phone_number'];
const possibleContentFields = ['content', 'text', 'body', 'message'];
const possibleSenderFields = ['role', 'sender', 'from_me', 'is_bot'];

async function fetchMessagesByConversationId(id) {
  if (!supabase) return { data: [], table: null, idCol: null };
  let lastError = null;
  for (const table of possibleMessageTables) {
    for (const idCol of possibleIdColumns) {
      try {
        const { data, error, status } = await supabase
          .from(table)
          .select('*')
          .eq(idCol, id)
          .order('timestamp', { ascending: true });

        // Log raw response for debugging
        console.log(`[Supabase] query -> table=${table} idCol=${idCol} status=${status} error=${error ? error.message : null}`);
        console.log('[Supabase] raw response data sample:', Array.isArray(data) ? data.slice(0, 5) : data);

        if (error) {
          lastError = error;
          // continue trying other id columns / tables
          continue;
        }

        if (data && data.length >= 0) {
          // Normalize fields
          const normalized = (data || []).map(row => {
            const content = possibleContentFields.map(f => row[f]).find(v => v != null);
            const senderVal = possibleSenderFields.map(f => row[f]).find(v => v != null);
            // Derive direction if possible
            let direction = row.direction || undefined;
            if (direction == null) {
              if (typeof senderVal === 'boolean') {
                direction = senderVal ? 'outgoing' : 'incoming';
              } else if (typeof senderVal === 'string') {
                const low = senderVal.toLowerCase();
                if (['bot', 'system', 'outgoing'].includes(low)) direction = 'outgoing';
                if (['user', 'incoming', 'customer'].includes(low)) direction = 'incoming';
              }
            }

            return Object.assign({}, row, {
              _raw_table: table,
              _raw_id_column: idCol,
              content: content,
              sender: senderVal,
              direction: direction,
              timestamp: row.timestamp || row.created_at || row.updated_at || null
            });
          });

          return { data: normalized, table, idCol };
        }
      } catch (err) {
        // record and continue
        console.warn(`[Supabase] exception while querying table=${table} idCol=${idCol}:`, err && err.message ? err.message : err);
        lastError = err;
        continue;
      }
    }
  }

  return { data: [], table: null, idCol: null, error: lastError };
}

// Authentication Middleware - Read-Only Security Guard
const requireReadAuthentication = (req, res, next) => {
  // Use configured secret or default to a local-testing secret
  const secretKey = process.env.MONITOR_SECRET_KEY || 'frank2026';

  // Accept header x-monitor-key or query param ?key=
  const providedKey = req.headers['x-monitor-key'] || req.query.key;

  if (!providedKey || providedKey !== secretKey) {
    console.warn(`[Monitor] Unauthorized request to ${req.originalUrl} from ${req.ip || req.connection.remoteAddress} - providedKey=${providedKey}`);
    return res.status(401).json({
      error: 'Unauthorized access',
      message: 'A valid monitor security key is required to access the dashboard.'
    });
  }

  console.log(`[Monitor] Authorized request to ${req.originalUrl} from ${req.ip || req.connection.remoteAddress}`);
  next();
};

// GET: Health Check (Public endpoint for Render health checks)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'bot-reumatologia-cqpharma-monitor',
    timestamp: new Date().toISOString(),
    mode: 'READ_ONLY'
  });
});

// Apply Read-Only Authentication middleware to all remaining /api routes
app.use('/api', requireReadAuthentication);

// GET: Bot Statistics
app.get('/api/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    if (!supabase) {
      return res.json({
        status: 'ONLINE',
        uptimeSeconds: Math.floor(process.uptime()),
        conversationsToday: 0,
        messagesIncomingToday: 0,
        messagesOutgoingToday: 0,
        conversations24h: 0,
        activeConversations: 0,
        averageResponseTimeMs: 1200
      });
    }

    // Fetch conversation count for today
    const { count: convsToday } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .gte('updated_at', today.toISOString());

    // Fetch conversations active in last 24h
    const { count: convs24h } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .gte('updated_at', twentyFourHoursAgo);

    // Fetch total incoming messages today
    const { count: incomingCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('direction', 'incoming')
      .gte('timestamp', today.toISOString());

    // Fetch total outgoing bot responses today
    const { count: outgoingCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('direction', 'outgoing')
      .gte('timestamp', today.toISOString());

    res.json({
      status: 'ONLINE',
      uptimeSeconds: Math.floor(process.uptime()),
      conversationsToday: convsToday || 0,
      messagesIncomingToday: incomingCount || 0,
      messagesOutgoingToday: outgoingCount || 0,
      conversations24h: convs24h || 0,
      activeConversations: convs24h || 0,
      averageResponseTimeMs: 1450
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch statistics', details: err.message });
  }
});

// GET: List Conversations with filter & search
app.get('/api/conversations', async (req, res) => {
  try {
    const { search, filter, limit = 50 } = req.query;

    if (!supabase) {
      return res.json([]);
    }

    let query = supabase
      .from('conversations')
      .select('*, messages(content, timestamp, direction, message_type)')
      .order('updated_at', { ascending: false })
      .limit(parseInt(limit, 10));

    // Search filter across contact name and phone number
    if (search && search.trim() !== '') {
      const term = search.trim();
      query = query.or(`contact_name.ilike.%${term}%,phone.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Ensure each conversation has messages: if not provided by the join, try fetching from possible message tables
    let conversations = data || [];
    conversations = await Promise.all((conversations).map(async conv => {
      try {
        if (!conv.messages || conv.messages.length === 0) {
          // Try fetching by conversation id
          let fetched = await fetchMessagesByConversationId(conv.id);
          if ((!fetched || !fetched.data || fetched.data.length === 0) && conv.phone) {
            // Try fetching by phone number as fallback
            const fetchedPhone = await fetchMessagesByConversationId(conv.phone);
            if (fetchedPhone && fetchedPhone.data && fetchedPhone.data.length > 0) fetched = fetchedPhone;
          }
          if (fetched && fetched.error) {
            console.warn('[Supabase] fetchMessagesByConversationId error for conv=', conv.id, fetched.error);
          }
          conv.messages = (fetched && fetched.data) ? fetched.data : [];
        }
      } catch (e) {
        console.warn('[Conversations] error fetching messages for conv', conv.id, e && e.message ? e.message : e);
        conv.messages = conv.messages || [];
      }
      return conv;
    }));

    // Post-process messages to format latest message snippet
    let results = conversations.map(conv => {
      const msgs = conv.messages || [];
      const sortedMsgs = msgs.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const latestMsg = sortedMsgs[0] || null;
      return {
        id: conv.id,
        contact_name: conv.contact_name || 'Contacto WhatsApp',
        phone: conv.phone,
        status: conv.status || 'active',
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        unread: conv.unread || false,
        latest_message: latestMsg ? {
          content: latestMsg.content,
          timestamp: latestMsg.timestamp,
          direction: latestMsg.direction,
          type: latestMsg.message_type || latestMsg.type || null
        } : null,
        has_images: msgs.some(m => (m.message_type === 'image' || m.type === 'image')),
        has_files: msgs.some(m => (m.message_type === 'document' || m.type === 'document' || m.message_type === 'audio' || m.type === 'audio'))
      };
    });

    // Apply categorical filters in memory
    if (filter === '24h') {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      results = results.filter(c => new Date(c.updated_at) >= dayAgo);
    } else if (filter === 'images') {
      results = results.filter(c => c.has_images);
    } else if (filter === 'files') {
      results = results.filter(c => c.has_files);
    } else if (filter === 'unread') {
      results = results.filter(c => c.unread);
    }

    res.json(results);
  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({ error: 'Failed to fetch conversations', details: err.message });
  }
});

// GET: Single Conversation Details
app.get('/api/conversations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!supabase) return res.status(404).json({ error: 'Conversation not found' });

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Conversation not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Complete Message History for a Conversation
app.get('/api/conversations/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    if (!supabase) return res.json([]);

    const result = await fetchMessagesByConversationId(id);

    // If helper reported an error, surface it to the client with details
    if (result && result.error) {
      console.error('[Supabase] error querying messages for id=', id, result.error);
      return res.status(500).json({ error: 'Failed to query messages', details: result.error.message || result.error });
    }

    console.log(`[Messages] fetched ${Array.isArray(result.data) ? result.data.length : 0} rows for id=${id}, table=${result.table}, idCol=${result.idCol}`);
    res.json(result.data || []);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET: Bot Activity Log Stream
app.get('/api/activity', async (req, res) => {
  try {
    if (!supabase) return res.json([]);

    const { data, error } = await supabase
      .from('messages')
      .select('id, conversation_id, direction, message_type, content, timestamp')
      .order('timestamp', { ascending: false })
      .limit(30);

    if (error) throw error;

    const activityLogs = (data || []).map(m => ({
      id: m.id,
      timestamp: m.timestamp,
      event: m.direction === 'incoming' ? 'Mensaje Recibido de Cliente' : 'Respuesta Automática Generada por Bot',
      type: m.direction === 'incoming' ? 'INCOMING' : 'BOT_REPLY',
      details: m.content ? (m.content.substring(0, 80) + (m.content.length > 80 ? '...' : '')) : `Archivo [${m.message_type}]`,
      conversation_id: m.conversation_id
    }));

    res.json(activityLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve dashboard static assets
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route to serve dashboard SPA
app.get('(.*)', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express server
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🤖 BOT MONITOR — CQPHARMA (READ-ONLY)`);
  console.log(`🌐 Express Server listening on port ${PORT}`);
  console.log(`🔒 Mode: STRICT READ-ONLY MONITORING`);
  console.log(`===================================================`);
});