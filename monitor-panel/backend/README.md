Monitor Panel Backend

Endpoints:
- GET /api/conversations -> list of conversations
- GET /api/conversations/:id/messages -> messages for conversation
- POST /api/hook -> normalized webhook forwarder (see README root for payload)
- GET /api/search?q=term -> search conversations by number or name

Realtime:
- Socket.IO broadcasts:
  - 'message' with the saved message object
  - 'conversation:update' with metadata to reorder sidebar

Integration tips:
- In your bot webhook handler (the one that receives Meta Cloud API events), normalize messages and POST them to this panel's /api/hook.
- Example (Node fetch):
  await fetch('https://panel.example.com/api/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(normalizedMessage) });

Deployment to Render:
- Create a new Web Service.
- Set the start command to: npm run start
- Set environment variables (PORT, optionally DB connection strings)
- Allow inbound connections and ensure CORS is configured for where the frontend is hosted.

Security note:
- This sample uses an open socket and no auth by default. Protect it with basic auth / JWT / IP restrictions in production.
