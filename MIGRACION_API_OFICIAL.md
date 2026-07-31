MIGRACIÓN A WHATSAPP CLOUD API (Meta) - Resumen operativo
=========================================================

Objetivo: migrar del conector no oficial (Baileys) a la API oficial de WhatsApp Cloud para reducir riesgo de restricciones y cumplir con las políticas de Meta.

1) Pasos generales para verificar negocio y registrar un número
- Crear / usar una cuenta de Meta Business Manager (https://business.facebook.com).
- Verificar el negocio: aportar documentos de la empresa (persona jurídica) y verificar identidad según los requisitos de Meta.
- En Business Manager, añadir un Business Account y completar verificación (puede requerir 1-7+ días según país y la información aportada).
- En la sección de WhatsApp Business, crear o seleccionar una cuenta de WhatsApp Business (WABA) y seguir el flujo para vincular un número de teléfono.
- Solicitar acceso a la API y configurar un token de acceso permanente (o un token de larga duración) y el número de teléfono en el Business Manager.
- Configurar el Webhook: registra una URL pública en el panel de Meta donde se recibirán las notificaciones de mensajes entrantes.

Tiempo estimado:
- Verificación básica de negocio: puede tomar desde 1 día hasta varias semanas, típicamente 2-10 días en muchos casos. Contar con 7-14 días como ventana razonable para planificación.

2) Librerías / SDKs recomendados en Node.js
- Meta proporciona endpoints HTTP para la Cloud API; en Node.js se suele usar una librería HTTP (axios/fetch) o SDKs comunitarios.
- Librería oficial de Meta (cuando esté disponible): revisar la documentación oficial en https://developers.facebook.com/docs/whatsapp/cloud-api
- Librerías útiles:
  - 'whatsapp-business-api' (comunidad) — revisa su mantenimiento antes de usar.
  - Recomendación práctica: implementar un cliente ligero usando axios/fetch para llamadas a la Cloud API (mensajes, templates) y exponer un webhook para recibir mensajes entrantes.

3) Cambios de arquitectura en whatsapp.js
- Baileys (socket persistente): mantiene una conexión websocket y emite eventos 'messages.upsert'.
- Cloud API (oficial): operación por HTTP + Webhooks.
- Cambios concretos:
  - Se eliminaría makeWASocket y useMultiFileAuthState.
  - Se añade un servidor HTTP (Express) endpoint publico /webhook que reciba eventos POST desde Meta: mensajes entrantes, estado de entrega, etc.
  - Para enviar mensajes se llama a la API HTTP de Meta (POST /v15.0/{PHONE_NUMBER_ID}/messages) con el token de acceso del WABA.
  - El manejo de QR/credenciales desaparece: la sesión ya está gestionada por Meta.
  - La lógica de negocio (obtenerRespuestaIA, saveLead, parseFechaHora) puede permanecer; solo cambiaría la capa de transporte (socket → webhook + http client).

4) Costos y consideraciones de conversación
- Meta suele cobrar por plantilla (template) para mensajes iniciados por la empresa y por sesión para conversaciones iniciadas por la empresa en algunas modalidades. Sin embargo, para conversaciones iniciadas por el cliente (nuestro caso: paciente escribe primero), la Cloud API suele considerar estas como conversaciones gratuitas o dentro de una categoría de servicio (revisar el plan de precios vigente en la región).
- Confirma en la consola de Meta/Business Manager la política aplicable y la estructura de precios en tu país antes de migrar a producción.

5) Recomendaciones operativas
- Mantener el conector actual solo durante la fase piloto y planear la migración a Cloud API antes de abrir a muchos clientes.
- Preparar la infraestructura de Webhooks con HTTPS y SSL (Render/Heroku/VPS con certbot o proveedor gestionado).
- Implementar un endpoint de verificación de webhook (challenge-response) según la documentación de Meta.
- Probar el flujo completo con un número de prueba antes de migrar números de clientes reales.

6) Conversaciones iniciadas por paciente vs. mensajes salientes
- Confirmación: para casos donde el paciente inicia la conversación, se aplican las conversaciones de servicio (bajo la política de Meta), lo que minimiza o elimina cargos por conversación en muchas regiones. No se necesita la categoría 'marketing'.
- Aún así, revisar las políticas locales ya que los detalles y precios pueden variar por país y por el tipo de plantilla usada para mensajes proactivos.

Referencias rápidas:
- Documentación oficial: https://developers.facebook.com/docs/whatsapp/cloud-api
- Guía de Webhooks: buscar "WhatsApp Cloud API Webhooks" en la documentación de Meta.


