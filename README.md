BotMensajes
=============

Descripción
-----------
Bot de mensajería para agendamiento que integra WhatsApp (Baileys) con Gemini (Google Generative AI) para extracción de datos mediante Function Calling. Diseñado para alto volumen y respuestas cortas.

Variables de entorno (.env)
---------------------------
Colocar un archivo .env en la raíz con al menos las siguientes variables (NO subir .env a git):

- GEMINI_API_KEY=tu_clave
- GEMINI_MODEL=gemini-3.5-flash-lite
- ADMIN_WHATSAPP_NUMBER=+51XXXXXXXXX
- PORT=3000

Este proyecto utiliza un loader propio (src/envLoader.js) que lee .env y asigna variables a process.env solo si no existen ya (respeta variables definidas por PM2/host). No se usa dotenv.

Cómo correr el bot
------------------
1. Instalar dependencias: npm install
2. Asegurarse de tener .env en la raíz con GEMINI_API_KEY
3. Iniciar: npm start

Tests y verificaciones
----------------------
- Smoke test que valida Function Calling y guardado de leads: npm run test:smoke (ejecuta scripts/smoke-test.js)
- Test de parseo de fechas: node scripts/test-fechas.mjs

Política de fallback heurístico
------------------------------
- Function Calling (Gemini) es el flujo principal. El sistema solo recurre al parser heurístico local como red de seguridad en caso de errores de red/servidor (timeouts, 5xx, ECONN*). No se usa fallback en errores de permisos (403), modelo inexistente (404) o fallos de autorización.
- Cuando el fallback heurístico se activa en producción se registra una advertencia visible: console.warn('⚠️ Fallback heurístico activado ...').

Seguridad
--------
- .env está incluido en .gitignore y nunca debe subirse.
- Se eliminó la dependencia 'dotenv' y se reemplazó por un loader propio para evitar vectores de prompt-injection dirigidos a agentes de IA.

Notas finales
------------
- Commit inicial creado localmente. No se ha hecho push a ningún remoto.
- Si se rota la GEMINI_API_KEY, vuelva a actualizar .env y vuelva a ejecutar: npm run test:smoke
