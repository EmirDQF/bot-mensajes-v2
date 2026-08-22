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
- CLINIC_NAME=LUMINZU Dent
- CLINIC_ADDRESS=📍 Av. Alameda de la República 286 - Huánuco
- CLINIC_HOURS=Lunes a Sábado: 9:00 a. m. – 8:00 p. m. | Domingo: CERRADO
- CLINIC_CONTACT_PHONE=
- CLINIC_DOCTOR_NAME=equipo de LUMINZU Dent
- PORT=3000
- WHATSAPP_TOKEN=tu_token_de_meta_whatsapp  # token con scope whatsapp_business_management
- WHATSAPP_WEBHOOK_VERIFY_TOKEN=tu_token_de_verificacion_del_webhook

Este proyecto utiliza un loader propio (src/envLoader.js) que lee .env y asigna variables a process.env solo si no existen ya (respeta variables definidas por PM2/host). No se usa dotenv.

Se incluye un script auxiliar para registrar (override) el webhook de la WABA contra una URL de callback. Instrucciones rápidas:

1. Exportar las variables necesarias (o ponerlas en .env) antes de ejecutar:
   - WHATSAPP_TOKEN
   - WHATSAPP_WEBHOOK_VERIFY_TOKEN
   - (Opcional) WABA_ID, CALLBACK_URL, GRAPH_VERSION

2. Ejecutar desde la raíz del proyecto:
   node override-webhook.mjs

El script intentará conectar la callback URL directamente en la WABA y luego verificará el estado. Revisa las respuestas en consola para corregir permisos o scopes si Meta responde con errores (ej. falta whatsapp_business_management o permisos de Business Manager).

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
