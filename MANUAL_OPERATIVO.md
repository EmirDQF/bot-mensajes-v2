MANUAL OPERATIVO - BotMensajes
================================

Fecha: 2026-07-30
Propietario: Tú (dueño del negocio)

Este documento es para uso operativo y comercial: explica en lenguaje simple qué hace el bot, cómo ponerlo en marcha para una clínica nueva, qué esperar, y cómo actuar ante fallos.

1) Qué hace el bot exactamente (historia paso a paso)
---------------------------------------------------
Imagina a una paciente llamada María que quiere pedir una cita:

1. María escribe por WhatsApp al número de la clínica: "Hola, quiero agendar una consulta para brackets".
2. El bot ("Camila") recibe el mensaje y responde con un saludo y preguntas guía si hace falta.
3. Mientras conversa, el motor de inteligencia (Gemini) revisa la conversación y extrae automáticamente los datos relevantes: nombre, teléfono, distrito y la fecha/hora propuesta.
4. Si detecta intención de agendar, el bot confirma la fecha/hora (cuando puede) y crea un registro de lead en los archivos de la clínica.
5. El sistema guarda el lead (teléfono, nombre, distrito, fecha propuesta, si quedó confirmada) y marca un registro para que un humano lo valide / contacte.
6. Tú (o el equipo administrativo) recibes una notificación/alerta (la forma depende de cómo lo implementes: email, webhook, o revisión manual del archivo de leads) para que un asesor confirme la cita y la cierre en el sistema de la clínica.

Resultado práctico: el bot filtra y captura solicitudes de agendamiento en WhatsApp, reduciendo trabajo manual y asegurando que los datos estén estructurados para seguimiento.

2) Cómo se activa / enciende para una clínica nueva (pasos exactos)
-----------------------------------------------------------------
Antes de instalar pide a la clínica que te entregue:
- Nombre legal de la clínica (para mensajes y saludos).
- Números de contacto administrativos (quién se encargará de revisar leads).
- Precios/sesiones u oferta principal (para respuestas sobre tarifas básicas).
- Horarios de atención y zonas (para validar disponibilidad al agendar).
- Promociones vigentes (si quieres que el bot las mencione automáticamente).

Pasos técnicos (lo mínimo que debes editar / configurar):
1. En el archivo C:/Users/Usuario/Desktop/BotMensajes/src/config.js hay una sección CLINIC_CONFIG. Edita esos campos con: nombre de la clínica, horario (p. ej. lun-vie 09:00-18:00), precios y promociones. (Si quieres que lo haga yo, dime y lo actualizo.)
2. Coloca el archivo .env en la raíz con estas variables (NO compartirlas):
   - GEMINI_API_KEY=tu_clave_generada_en_Google_AI_Studio
   - GEMINI_MODEL=gemini-3.5-flash-lite
   - ADMIN_WHATSAPP_NUMBER=+51XXXXXXXXX (opcional, para notificaciones)
   - PORT=puerto (por defecto 3000)
3. Ejecuta en tu máquina: npm install (si no lo hiciste) y luego npm start.
4. Generar el QR para vincular WhatsApp:
   - Al arrancar, el bot (Baileys) emite un QR en la consola o lo guarda en ./auth_info (según la configuración). Con un teléfono físico del cliente:
     a) Abre WhatsApp Business en el teléfono de la clínica.
     b) Ve a "Dispositivos vinculados" y elige "Vincular un dispositivo".
     c) Escanea el QR que aparece en la consola del servidor o abre el archivo de QR si se guardó.
   - Una vez escaneado, el bot quedará conectado al WhatsApp de la clínica y empezará a recibir mensajes dirigidos a ese número.
5. Transferir la sesión (opcional): cuando la sesión ya está en ./auth_info, ese folder puede mantenerse en el servidor para reconexiones automáticas.

¿Corre en mi laptop o necesito servidor 24/7?
- Para demostraciones o pruebas: puedes correrlo en tu laptop (npm start) y mostrar la demo en vivo.
- Para producción 24/7: necesitas un servidor que esté siempre encendido. Opciones simples y económicas:
  - Render (recommended for 1-3 clients): fácil deploy, plan de inicio económico y auto-restart. Buen equilibrio facilidad/costo.
  - Railway: muy rápido para prototipos y escalado gradual.
  - VPS barato (DigitalOcean / Hetzner / Vultr): si quieres mayor control, un droplet desde ~US$5/mes puede ser suficiente para 1-3 clientes.
Recomendación práctica para empezar: usar Render (o Railway) porque simplifica certificados, logs y reinicios automáticos; luego migrar a VPS si necesitas control de costos o configuraciones especiales.

Tiempo estimado para ponerlo en marcha para una clínica:
- Preparar datos y .env: 15–30 minutos (la clínica debe proveer información y número para vincular).
- Conexión y prueba (incluye escanear QR con su teléfono): 5–10 minutos.
- Ajustes de mensaje y prueba final: 15–30 minutos.
Total típico: 30–90 minutos por clínica si no hay problemas con el número o permisos.

3) Qué puede y qué NO puede hacer el bot (lista honesta)
--------------------------------------------------------
Qué puede:
- Detectar intención de agendamiento en conversaciones sencillas y estructurar datos (nombre, teléfono, distrito, fecha/hora propuesta).
- Confirmar y guardar leads automáticamente para que un humano complete el cierre.
- Responder preguntas básicas (saludo, preguntar disponibilidad) si están cubiertas por las plantillas o conocimientos previos.
- Operar 24/7 si está desplegado en un servidor, recoger leads fuera de horario y mantener el historial en auth_info/ y leads.json.

Qué NO puede (límites actuales):
- No reemplaza el contacto humano para cierres complejos: un asesor debe confirmar la cita y manejar excepciones.
- El parser de fechas puede fallar en frases muy ambiguas o poco comunes (ej.: "en algún momento del segundo lunes del mes que viene") — en esos casos la fecha puede quedar no confirmada y el lead requiere seguimiento manual.
- No es un sistema de facturación ni agenda automática conectada a un calendario externo — guarda propuestas de fecha; la confirmación final es manual (puede automatizarse más adelante con integraciones adicionales).
- Depende de la disponibilidad del modelo Gemini (si Google cambia políticas o el modelo tiene interrupciones, el bot puede necesitar ajustes). Tenemos un fallback heurístico pero solo se usa si hay errores de red/servidor.
- No maneja bien idiomas/jerga muy local fuera del español latino estándar sin entrenamiento adicional.

4) Cómo demostrarlo a un cliente potencial (guion corto para demo)
-----------------------------------------------------------------
Escena: llamada de venta + demostración en vivo (Loom o Zoom). Mensajes de ejemplo para enviar al bot durante la demo:

1) Cliente (usuario): "Hola, ¿son especialistas en brackets?"
   - Resultado esperado: Camila saluda y confirma servicio + precio básico.
2) Cliente: "¿Cuánto cuesta una consulta inicial?"
   - Resultado esperado: Bot responde con precio estándar (según CLINIC_CONFIG).
3) Cliente: "Quiero agendar, me llamo Ana Martínez, mi número es 987654321, vivo en Miraflores, ¿tienen mañana a las 3pm?"
   - Resultado esperado: Bot detecta intención, extrae nombre/teléfono/distrito, detecta fecha/hora, responde confirmando y guarda lead.
4) Cliente: "Perfecto, gracias"
   - Resultado esperado: Bot cierra con un mensaje de cortesía y ya quedó el lead registrado para que el equipo confirme.

Consejo de presentación: durante la demo, explica que el bot captura y estructura los datos (muestra el archivo leads.json o la interfaz de leads) y que el cierre de la cita lo hace un humano para evitar errores.

5) Qué pasa cuando algo falla en producción (procedimientos rápidos)
------------------------------------------------------------------
Escenarios y pasos que puedes ejecutar sin llamar a un programador:

- Si Baileys se desconecta (el bot deja de recibir mensajes)
  Qué ves: el servicio en el servidor mostrará logs con mensajes de reconexión o un fallo inicial; si el QR vuelve a aparecer significa que la sesión no se reconectó.
  Qué hacer: revisar los logs (Render/Railway/servidor) y reiniciar el servicio (en Render/ Railway hay botón "Restart"). Si el QR aparece, pide al contacto de la clínica que vuelva a escanearlo con el teléfono de la clínica.

- Si Gemini da error (timeouts o 5xx)
  Qué ves: en los logs verás advertencias; el bot puede usar el fallback heurístico y aún así guardar leads parciales.
  Qué hacer: primero revisar si tu clave (GEMINI_API_KEY) sigue válida en Google AI Studio. Si la clave fue rotada o revocada, pegar la nueva en .env (o en las variables de entorno del proveedor) y reiniciar. Si el error es prolongado, informar al cliente que se puede re-intentar más tarde — los leads siguen guardándose en archivo para revisión manual.

- Si .env se pierde o no contiene GEMINI_API_KEY
  Qué ves: al arrancar, el bot imprime un error indicando que falta la clave y no realiza llamadas a Gemini; las funciones de extracción quedan en modo test/fallback.
  Qué hacer: restaurar .env con la clave correcta y reiniciar el servicio. Si usas un proveedor (Render/Railway), pon la variable en el panel de configuración de variables de entorno.

- Si un lead no tiene fechaParseada (fechaHoraConfirmada: false)
  Qué ves: el lead queda con fechaHoraConfirmada=false en el archivo leads.json o leads.test.json.
  Qué hacer: contactar al paciente para confirmar hora (manual) y actualizar el registro.

6) Costos operativos reales (estimación práctica)
------------------------------------------------
Nota: los precios y límites de uso de Gemini cambian en el tiempo; la recomendación es revisar la página de precios de Google Generative AI para tu cuenta. A continuación hay una estimación orientativa para planear costos:

- Uso en demo / pruebas: el nivel gratuito de Google (si aplica) suele cubrir experimentación y pocos cientos de interacciones cortas por mes.
- Uso en producción (estimación conservadora): cada conversación de agendamiento corta (preguntas + extracción) suele ser muy pequeña en tokens (respuesta corta). Para un volumen bajo-moderado (100–500 interacciones/mes por clínica) es probable que los costos sean muy bajos (orden de decenas de dólares al mes) si usas un modelo "flash-lite" orientado a bajo costo.
- Punto de pago: cuando superes los créditos gratuitos de Google, empezarás a ver cargos. Para 1–3 clínicas con actividad moderada, un presupuesto inicial de US$5–30/mes por clínica suele ser suficiente como punto de partida (esto depende fuertemente del número de mensajes por paciente y del tamaño de las respuestas).

Recomendación práctica:
- Empieza con el plan gratuito/crédito de Google para probar con 1-2 clínicas.
- Monitoriza el consumo en Google Cloud (dashboard) y establece alertas de coste.
- Si el negocio crece, dimensiona según interacciones reales (puedo ayudarte a calcular con métricas reales una vez tengas datos de uso).

---

Soporte y persona de contacto:
- Si quieres, puedo preparar una hoja con checklist para onboarding por clínica (checklist imprimible con los campos que solicitas a la clínica y los pasos a ejecutar).

Fin del manual operativo.
