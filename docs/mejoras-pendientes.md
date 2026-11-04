# Mejoras pendientes del camino crítico (severidad MEDIA)

Revisión del 4 de noviembre de 2026 (rama `mejora/dia-de-cierre`). Los hallazgos CRÍTICOS y ALTOS ya están
corregidos y cubiertos por `services/criticalPath.test.js`. Estos quedan para después de la demo: ninguno rompe
el flujo de hoy.

| # | Archivo:línea | Qué pasa | Escenario | ¿Real o posible? |
|---|---|---|---|---|
| M1 | `middleware/verifySignature.js:6` | La firma de Meta solo se exige si `ENFORCE_WHATSAPP_SIGNATURE=true` (por defecto `false`). | Una clínica nueva desplegada sin `render.yaml` acepta webhooks falsos: cualquiera podría hacer que el bot escriba a números arbitrarios. Hoy `render.yaml` ya la pone en `true`. | Posible |
| M2 | `controllers/webhookController.js:741` | Un paciente que escribe solo "borrar" o "reset" borra su conversación, lead y pase a humano sin recibir confirmación. | Un paciente en urgencia escribe "borrar" y desaparece de la bandeja de recepción. | Posible |
| M3 | `controllers/webhookController.js:805` | Si falla la descarga de la foto del paciente, no se le responde nada (ni siquiera el pie de foto). | Meta no entrega la foto → el paciente queda sin respuesta. | Posible |
| M4 | `controllers/webhookController.js` (`processBatch`, envío del texto) | Si WhatsApp rechaza el texto final tras los reintentos, nadie se entera: no hay alerta a recepción. | Token vencido: lo detecta `systemAlerts`, pero un 4xx por otra causa queda solo en el log. | Posible |
| M5 | `controllers/webhookController.js:168` | `chat_sessions.history` crece sin tope y se reenvía completo en cada upsert. | Una conversación de cientos de mensajes hace cada escritura más pesada. | Real (lento) |
| M6 | ~~`services/whatsappService.js` `sendStatus`~~ | **Resuelto** (rama `mejora/recepcionista-experta`): una sola llamada con timeout, nunca lanza y registra el motivo de Meta. | — | — |
| M7 | `services/whatsappService.js` (reintento tras timeout) | Un POST que Meta sí procesó pero respondió tarde se reintenta. | El paciente recibe el mismo mensaje dos veces. | Posible |
| M8 | ~~`services/geminiService.js` `callGemini`~~ | **Resuelto** (rama `mejora/recepcionista-experta`): tope total `GEMINI_TOTAL_TIMEOUT_MS` (35 s), backoff con jitter y respuesta sin IA antes del aviso genérico. | — | — |
| M9 | `services/geminiService.js:630` | `[Gemini Error Detallado]` loguea el objeto de error completo (incluye stack). | Hoy no trae datos del paciente, pero conviene usar `describeError` de `services/safeLog.js`. | Posible |
| M10 | `services/messageDedup.js:30` | El mensaje se marca como visto antes de procesarse. | Si el proceso se reinicia justo después, el reintento de Meta se descarta y el mensaje se pierde. | Posible (compromiso aceptado) |
| M11 | `controllers/webhookController.js:327` | Chequeo manual del TTL de reprogramación, ya redundante con `createExpiringMap`. | Ninguno (limpieza). | — |
| M12 | `controllers/webhookController.js` (876 líneas) | Sigue por encima del tope blando de 800 líneas. Siguiente extracción segura: primer contacto (`hasPreviousConversation`, `sendFirstContactWelcome`, `greetFirstContact`) y `extractPlainText`/`stripInstructionTags` a módulos propios con tests. | Mantenimiento. | — |
| M13 | Probador con hora simulada | El mensaje del paciente se guarda con la hora simulada y la respuesta del bot con la real, así que en la bandeja de prueba el orden puede verse invertido. | Solo afecta al Probador (`is_test`), no a pacientes reales. | Real (cosmético) |
