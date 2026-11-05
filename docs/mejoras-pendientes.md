# Mejoras pendientes del camino crítico (severidad MEDIA)

Revisión del 4 de noviembre de 2026 (rama `mejora/dia-de-cierre`). Los hallazgos CRÍTICOS y ALTOS ya están
corregidos y cubiertos por `services/criticalPath.test.js`. Estos quedan para después de la demo: ninguno rompe
el flujo de hoy.

| # | Archivo:línea | Qué pasa | Escenario | ¿Real o posible? |
|---|---|---|---|---|
| M1 | ~~`middleware/verifySignature.js:6`~~ | **Resuelto** (rama `mejora/agente-top`): con `NODE_ENV=production` la firma de Meta es obligatoria por defecto; solo se desactiva con `ENFORCE_WHATSAPP_SIGNATURE=false` explícito. | — | — |
| M2 | `controllers/webhookController.js:741` | Un paciente que escribe solo "borrar" o "reset" borra su conversación, lead y pase a humano sin recibir confirmación. | Un paciente en urgencia escribe "borrar" y desaparece de la bandeja de recepción. | Posible |
| M3 | `controllers/webhookController.js:805` | Si falla la descarga de la foto del paciente, no se le responde nada (ni siquiera el pie de foto). | Meta no entrega la foto → el paciente queda sin respuesta. | Posible |
| M4 | `controllers/webhookController.js` (`processBatch`, envío del texto) | Si WhatsApp rechaza el texto final tras los reintentos, nadie se entera: no hay alerta a recepción. | Token vencido: lo detecta `systemAlerts`, pero un 4xx por otra causa queda solo en el log. | Posible |
| M5 | `controllers/webhookController.js:168` | `chat_sessions.history` crece sin tope y se reenvía completo en cada upsert. | Una conversación de cientos de mensajes hace cada escritura más pesada. | Real (lento) |
| M6 | ~~`services/whatsappService.js` `sendStatus`~~ | **Resuelto** (rama `mejora/recepcionista-experta`): una sola llamada con timeout, nunca lanza y registra el motivo de Meta. | — | — |
| M7 | `services/whatsappService.js` (reintento tras timeout) | Un POST que Meta sí procesó pero respondió tarde se reintenta. | El paciente recibe el mismo mensaje dos veces. | Posible |
| M8 | ~~`services/geminiService.js` `callGemini`~~ | **Resuelto** (rama `mejora/recepcionista-experta`): tope total `GEMINI_TOTAL_TIMEOUT_MS` (35 s), backoff con jitter y respuesta sin IA antes del aviso genérico. | — | — |
| M9 | `services/geminiService.js:630` | `[Gemini Error Detallado]` loguea el objeto de error completo (incluye stack). | Hoy no trae datos del paciente, pero conviene usar `describeError` de `services/safeLog.js`. | Posible |
| M10 | `services/messageDedup.js:30` | El mensaje se marca como visto antes de procesarse. | Si el proceso se reinicia justo después, el reintento de Meta se descarta y el mensaje se pierde. | Posible (compromiso aceptado) |
| M11 | ~~`controllers/webhookController.js:327`~~ | **Resuelto** (rama `mejora/agente-top`): se quitó el chequeo manual; el vencimiento lo hace `createExpiringMap`. | — | — |
| M12 | ~~`controllers/webhookController.js` (876 líneas)~~ | **Resuelto** (rama `mejora/agente-top`): primer contacto en `controllers/firstContact.js`, bandeja/historial en `controllers/conversationStore.js`, imágenes en `controllers/mediaReplies.js` y limpieza de texto en `services/replyText.js` (con tests). | — | — |
| M13 | Probador con hora simulada | El mensaje del paciente se guarda con la hora simulada y la respuesta del bot con la real, así que en la bandeja de prueba el orden puede verse invertido. | Solo afecta al Probador (`is_test`), no a pacientes reales. | Real (cosmético) |

## Revisión de la rama `mejora/agente-top` (5 de noviembre de 2026)

Revisión con un agente revisor de código y uno de seguridad. Los ALTOS ya están corregidos y cubiertos por
`services/reviewFixes.test.js`: firma de Meta obligatoria en producción, audio sin transcripción conserva su referencia,
consultas de campañas paginadas (más de 1000 filas), comillas del anuncio fuera del prompt, freno de precios solo con
montos reales y logs del panel con `describeError`. Quedan:

| # | Archivo | Qué pasa | Escenario | ¿Real o posible? |
|---|---|---|---|---|
| M14 | `services/appointmentService.js` (`reserveSlot`) | Sin la función `reserve_appointment` (migración 20261105 incompleta), la confirmación directa queda protegida solo por el candado del proceso y el índice de hora exacta. | Dos instancias de Render a la vez (deploy) y dos pacientes que eligen horarios que se solapan por duración: ambas citas nacen confirmadas. Hoy solo deja un aviso en el log; conviene una alerta en el panel. | Posible (requiere migración parcial + 2 procesos) |
| M15 | `services/campaignService.js` | Una campaña pausada por errores de calidad de Meta no se puede reanudar desde el panel. | El dueño debe crear otra campaña con el mismo segmento (los ya enviados quedan excluidos por la regla de 14 días). ¿Falta un botón "Reanudar"? | Real (decisión de producto) |
| M16 | `routes/jobs.js` (`POST /jobs/campaigns`) | Si se filtra `CRON_SECRET`, alguien puede adelantar el envío de campañas ya programadas por el dueño (no crear nuevas). | Rotar `CRON_SECRET` si se sospecha una filtración. | Posible |
| M17 | `services/clinicSettings.js` (`ensureBucket`) | El bucket `clinic-media` es público (Meta necesita descargar las fotos para enviarlas). | Cualquier foto subida en Mi clínica queda pública con un nombre aleatorio: nunca subir fotos de pacientes sin consentimiento (regla 12). | Real (intencional) |
| M18 | `middleware/panelAuth.js:33` | Usa `&` en vez de `&&` al comparar usuario y contraseña. | Funciona hoy (booleans), pero es frágil si cambia `safeEqual`. | Limpieza |
| M19 | `public/app/clinic/basics.js` | Guardar el horario registra "holidays" como cambiado aunque no haya feriados (vacío vs. sin definir). | Solo ensucia el historial de cambios. | Real (cosmético) |

## Revisión de "igual que el video", quick-demo y fases 6 a 8 (5 de noviembre de 2026)

Revisión con un agente revisor de código y uno de seguridad sobre `dd9b44b..HEAD`, más el webhook, la subida de
imágenes, el panel, las campañas y los datos de salud. **Sin hallazgos CRÍTICOS ni ALTOS.** El único MEDIO ya está
corregido. `npm run test:unit` 514/514 y `npm run simulate` 39/39 con Gemini real.

| # | Archivo | Qué pasa | Escenario | ¿Real o posible? |
|---|---|---|---|---|
| M20 | ~~`scripts/quick-demo-clinic.js` (`id`)~~ | **Resuelto**: el `id` del JSON iba directo a rutas de archivos; ahora solo acepta `demo-` + letras, números y guiones (test en `quickDemoClinic.test.js`). | Un `prospecto.json` con `"id": "../../scripts/x"` escribía fuera de `config/clinics/`. | — |
| M21 | `scripts/quick-demo-clinic.js` (`logo`) | Lee la ruta local que diga `logo` en el JSON. Solo se usa si sus bytes son JPG, PNG o WebP de hasta 2 MB. | Riesgo bajo: es una herramienta local; usa solo JSON que tú escribiste. | Posible (bajo) |
| M22 | `services/firstVisitReply.js` y `services/catalog.js` | El formato del precio del pack (~regular~ *promo*, hasta el …) está en dos lugares. | Si cambia la regla de formato, hay que cambiarla en ambos. | Limpieza |
| M23 | `controllers/firstContact.js` | La bienvenida va con el logo y el aviso de privacidad; el video muestra un saludo solo de texto. | Se queda así: el aviso lo exige la Ley 29733. El texto se edita en Mi clínica. | Intencional |
| M24 | Probador | Las respuestas de Gemini varían entre tomas (es la IA real). | Al grabar un video, si una toma sale rara: "➕ Nueva conversación" y repetir. | Real (esperado) |
