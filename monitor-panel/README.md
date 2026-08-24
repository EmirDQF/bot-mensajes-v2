Monitor Panel (Realtime WhatsApp Conversations)

Overview

This folder contains a lightweight monitoring panel (backend + frontend) to view WhatsApp conversations in real time. It is designed to "mirror" messages from an existing bot (read-only) using a webhook-forwarding approach and push new messages to connected web clients via Socket.IO.

Structure

- backend/: Express + Socket.IO server that exposes REST endpoints and a webhook endpoint (/api/hook) to receive normalized messages.
- frontend/: Vite + React app that shows a sidebar of conversations and a chat view. Connects to the backend via REST + socket for realtime updates.

Quick start (development)

1) Backend
   cd monitor-panel/backend
   npm install
   # configure .env (see .env.example)
   npm run dev

2) Frontend
   cd monitor-panel/frontend
   npm install
   npm run dev

Integration with your bot/webhook

If your bot already receives Meta Cloud API webhooks, forward normalized messages to the monitor panel's webhook endpoint.

Example normalized payload (POST /api/hook):
{
  "conversation_id": "+5215512345678",
  "contact_name": "Juan",
  "sender": "user", // or "bot"
  "type": "text", // or "image"
  "content": "Hola",
  "media_url": null,
  "timestamp": "2026-08-23T21:00:00.000Z"
}

See backend/README for more integration notes and Render deployment steps.
