# Recepcionista 24/7 para pacientes de Meta Ads

**Para clínicas dentales que pagan anuncios de "Enviar mensaje" y no alcanzan a responder a tiempo, sobre todo de noche.**
Solo lo que el sistema ya hace hoy:

- **Responde en segundos, también de noche**, con los precios "desde", la campaña y las preguntas frecuentes de la
  clínica, y entiende cómo escriben los pacientes ("frenillos", "cuanto sale", "precio pls").
- **Muestra el tratamiento con imágenes** (las que la clínica sube en el panel) y la **tarjeta del pack de evaluación**
  con qué incluye y su precio. Nunca inventa precios ni promociones: todo sale de lo que la clínica configura.
- **Horarios libres reales en botones:** el paciente agenda con un toque.
- **Dos modos de agendamiento:** *solicitud* (recepción confirma; recomendado) o *confirmación directa* (el bot reserva
  sin dobles citas y envía un **pase de cita** con QR), solo si la agenda del panel es la única de la clínica.
- **Recordatorios** 48 h y 2 h antes (configurables) con botones Confirmo / Reprogramar.
- **Ficha a recepción y al doctor** en cada cita nueva, sin diagnósticos.
- **Urgencias a una persona:** ante dolor fuerte, sangrado, hinchazón, fiebre o golpe no diagnostica, pausa el bot y
  avisa a recepción de inmediato. Se presenta como asistente virtual.
- **Seguimiento respetuoso** si el paciente no responde (máximo 3 mensajes; se detiene si dice "no").
- **Promociones a pacientes anteriores** solo a quienes dieron su permiso, máximo una cada 14 días.
- **Audios del paciente** transcritos (opcional, con el plan pagado de Gemini).
- **Panel** para recepción y el dueño: bandeja en vivo, agenda, métricas medidas, reporte semanal, **Mi clínica** (la
  clínica cambia precios, horarios, imágenes y promociones sin programar), Campañas y Probador.

## Precio

**Instalación: S/ 800** = S/ 400 al aceptar + S/ 400 solo si en 7 días desde la conexión hay **2 citas de evaluación
confirmadas** que llegaron por el asistente. Si no, se devuelven los S/ 400.

**Mensualidad**, calculada desde el costo por clínica:

| Costo mensual por clínica | Monto | Fuente |
|---|---|---|
| Servidor Render, plan Starter (no se duerme) | US$ 7 | [Render pricing](https://render.com/pricing): Starter US$ 7/mes · VERIFICAR antes de cotizar |
| Gemini 3.5 Flash-Lite: ~2.500 tokens de entrada + ~150 de salida por respuesta (prompt medido hoy: ~1.900) × 1.000–3.000 respuestas | US$ 1–4 | US$ 0,30 / 2,50 por millón de tokens ([anotherwrapper](https://anotherwrapper.com/llm-pricing/gemini-3.5-flash-lite)) · VERIFICAR en [ai.google.dev/pricing](https://ai.google.dev/pricing) |
| Supabase (base de datos), plan gratuito | US$ 0 | VERIFICAR los límites del plan gratuito; Pro si se supera |
| cron-job.org (tareas programadas) | US$ 0 | Plan gratuito |
| **Total** | **≈ US$ 8–11 ≈ S/ 30–42** | Tipo de cambio S/ 3,75: VERIFICAR |
| WhatsApp (Meta) | **Lo paga la clínica a Meta, con su tarjeta** | Cobro por mensaje desde el 1/7/2025. Responder dentro de las 24 h con texto libre = servicio. Plantillas de utilidad (recordatorios, ficha al doctor, reporte) y de marketing (seguimiento del día 3, promociones: solo con permiso del paciente), con cobro en la ventana desde el 1/10/2026 ([Meta](https://developers.facebook.com/docs/whatsapp/pricing)). Tarifas de Perú en USD: **VERIFICAR** en el rate card oficial |

| Opción | Mensualidad | Incluye | Margen aprox. |
|---|---|---|---|
| **A. Esencial** ⭐ recomendada para hoy | **S/ 149** | Servidor, IA, monitoreo, 1 cambio de precios o campaña al mes, soporte por WhatsApp en horario laboral | ≈ S/ 107–119 |
| B. Crecimiento | S/ 249 | Lo de A + cambios ilimitados de precios y campañas, revisión mensual del reporte con el dueño y prueba nocturna mensual con captura | ≈ S/ 207–219 |

**Recomiendo la A** para el primer cliente: es fácil de aceptar junto con la instalación, cubre los costos con margen y
deja la B como mejora cuando el reporte muestre resultados.

## Requisitos para conectar (APIs oficiales de Meta)

- **Meta Business** de la clínica con acceso para ti (socio o administrador). **Verificación del negocio**: sin ella
  hay límites bajos de mensajes iniciados por la empresa y menos plantillas. El tiempo depende de Meta: VERIFICAR.
- **Número:** uno que reciba SMS o llamada para el código.
  - **Coexistencia** (seguir usando la app WhatsApp Business en el mismo número, por Embedded Signup): requiere la app
    v2.24.17 o superior, no sincroniza el historial, desactiva los mensajes temporales y el "eliminar para todos" en los
    chats 1:1, tiene un tope de 20 mensajes por segundo y no funciona con WhatsApp para Windows
    ([8x8](https://developer.8x8.com/connect/docs/whatsapp/whatsapp-business-app-coexistence),
    [Telnyx](https://developers.telnyx.com/docs/messaging/whatsapp/coexistence)). **Disponibilidad en Perú: VERIFICAR**
    (las listas públicas no mencionan Perú). Si no aplica: un número nuevo solo para el asistente, o migrar el actual
    (deja de funcionar en la app).
- **Método de pago** de la clínica en su cuenta de WhatsApp en Meta (para las plantillas).
- **Plantillas aprobadas** (`npm run meta:templates`): suelen tardar de minutos a horas (VERIFICAR con la primera).
- **Tiempo real de puesta en marcha:** 3–4 h de instalación (`plan-7-dias.md`, día 7) **más** lo que tarde Meta en la
  verificación y las plantillas. Prométele "conectado en cuanto Meta apruebe", no una fecha fija.

**Ley 29733:** el bot da el aviso de privacidad en el primer mensaje; los datos de salud son **sensibles** (la clínica
es titular del banco de datos y tú lo tratas por encargo, por escrito en el acuerdo) y el paciente puede escribir
"borrar mis datos" cuando quiera: el borrado ya existe.
