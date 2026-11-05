# Guion del video de demo — 90 segundos

**En una frase:** "Tu asistente de WhatsApp atiende a los pacientes de tus anuncios a cualquier hora: les muestra el
tratamiento con imágenes, les da los precios reales, les ofrece horarios en botones, les entrega su pase de cita y te
avisa a ti y al doctor."

Dos versiones con el **mismo guion**:

- **(A) REAL** (una vez desplegado): pantalla dividida con **WhatsApp Web** (tu celular hace de paciente) | el panel.
- **(B) DEMO** (sin Meta): `npm run demo` en tu computadora, con el **🧪 Probador** | el panel. Mismos pasos y la misma
  asistente (Gemini real), con pacientes inventados y WhatsApp simulado.

## Antes de grabar (5 min)

**(B) Demo**
- [ ] `GEMINI_API_KEY` en tu `.env` (sin ella el bot responde con textos fijos de respaldo, menos naturales).
- [ ] Opcional, para mostrar la ficha al doctor: `DOCTOR_ALERT_PHONE` con un número tuyo de prueba en el `.env`.
- [ ] `npm run demo` → `http://localhost:3000/panel` → entra como dueño (`PANEL_OWNER_USER`/`PANEL_OWNER_PASSWORD`; si
      no están, la consola muestra un usuario `demo` y una contraseña de un solo uso).
- [ ] La demo ya viene en **confirmación directa** (para que salga el pase de cita) y con la especialista ficticia.
- [ ] Ventana izquierda: **🧪 Probador** → **➕ Nueva conversación**. Derecha: otra ventana del panel en **Bandeja**.
- [ ] En pantalla, un aviso fijo: **"Datos de demostración · pacientes inventados"**.

**(A) Real**
- [ ] `npm run smoke:prod -- TU-URL` en ✅ y `npm run meta:check` sin ❌ (token PERMANENTE).
- [ ] Conversación limpia: escribe `reset` desde tu celular al bot.
- [ ] Si quieres mostrar el pase de cita: Mi clínica → 🤖 Asistente → **Confirmación directa** (solo si la Agenda del
      panel es la única de la clínica; en una demo con un número de prueba no hay problema).

## Guion (90 s)

| Seg. | Paciente (Probador / WhatsApp Web) | Lo que se ve | Voz en off |
|---|---|---|---|
| 0–10 | "Hola! Vi su anuncio en Instagram y me interesa mucho. Quiero mejorar mi sonrisa, ¿me dan información de ortodoncia o carillas por favor?" | Bienvenida con el logo y el aviso de privacidad | "Llega un paciente de un anuncio, a cualquier hora." |
| 10–25 | — | Llegan las imágenes **"Brackets metálicos vs zafiro"** y **"Carillas antes/después"** (ilustraciones), cada una con su texto, y la respuesta con los precios "desde" y 3 horarios en **botones** | "Le muestra el tratamiento con imágenes y le da los precios reales de la clínica, nunca inventados." |
| 25–40 | "Qué buenas fotos! ¿Tengo que llevar radiografías? ¿Qué necesito, qué días tienen espacio, cuánto cuesta empezar y cómo agendo? Soy Carlos Mendoza" | La **tarjeta del pack de evaluación** (qué incluye, precio regular tachado y precio de campaña con su fecha de fin) y la respuesta: "solo trae tu DNI…" + horarios en botones | "Resuelve todo de una: requisitos, precio para empezar y horarios libres reales." |
| 40–55 | Toca un **botón de horario** | El **pase de cita** en imagen (logo, colores, especialista, dirección, código y QR) y "Tu cita quedó *confirmada*… te recordaremos 48 h y 2 h antes" | "Agenda con un toque y recibe su pase de cita. El QR solo lleva el código, ningún dato personal." |
| 55–62 | — | El bot pregunta, una sola vez y con botones, si quiere recibir promociones | "Y pide permiso antes de enviarle promociones." |
| 62–72 | — | En el registro del Probador: la **ficha** que llega a recepción (y al doctor, si configuraste `DOCTOR_ALERT_PHONE`): paciente, interés, cita, recordatorio programado y enlace a la conversación. Luego la **Agenda** con la cita confirmada | "Recepción y el doctor reciben la ficha al instante, sin diagnósticos." |
| 72–82 | — | Pestaña **📊 Métricas**: primera respuesta, % sin intervención humana, solicitudes, confirmadas y asistencias | "Y tú ves los números que mide el sistema, no promesas." |
| 82–90 | Pantalla final con la oferta | — | "**S/ 400 al conectar y S/ 400 más solo si en 7 días el reporte muestra 2 citas de evaluación confirmadas, con tu pauta de Meta activa. Si no, te devuelvo los S/ 400.**" |

**Diferencias con un video "de agencia" (dilas así si te preguntan):**
- El Probador no muestra la tarjeta del anuncio de Instagram (en WhatsApp real sí llega el anuncio de origen).
- Los recordatorios no se ven en vivo porque la cita es para hoy o mañana: se ven como "programado" en la ficha.
- Las métricas de la demo salen de pacientes inventados; con una clínica real salen de sus conversaciones.

**Oferta y garantía (igual que `docs/ventas/propuesta.md`):** S/ 400 al conectar + S/ 400 si en los 7 días siguientes
el reporte del sistema muestra al menos 2 citas de evaluación confirmadas (o asistidas). Si no, se devuelven los S/ 400
pagados al conectar. Condición: la clínica mantiene su **pauta activa en Meta durante los 7 días** y recepción marca
las solicitudes en el panel.

## Versión personalizada por prospecto (5 min)

Muestra al director **su** clínica, sin tocar código ni producción:

1. `npm run demo` → entra como dueño → **🏥 Mi clínica**.
2. **Datos:** nombre, dirección, **logo** (descárgalo de su Facebook) y colores. **Tratamientos:** sus precios "desde"
   (de su anuncio o su web; si no los publica, deja los de la demo y dilo). **Pack de evaluación** y **Promociones:**
   solo lo que ofrecen de verdad (mira su anuncio en Meta Ad Library). **Guardar** en cada sección.
3. Usa **🔄 Actualizar vista previa** para ver su tarjeta del pack y su pase de cita con sus colores.
4. **🧪 Probador** → graba el guion (B) y envíaselo con tu mensaje (`docs/ventas/mensajes-contacto.md`).

Todo queda en el Supabase **en memoria** de la demo: al cerrar `npm run demo` se borra.

## Plan B si algo falla en vivo

- **No responde (A):** `npm run meta:check`. Si dice **TOKEN DE WHATSAPP VENCIDO**, cambia el token (`docs/go-live.md`).
  Mientras, graba la versión (B).
- **Responde con textos fijos (B):** falta `GEMINI_API_KEY` o Gemini está saturado; el catálogo, el pack, los botones y
  el pase funcionan igual.
- **Bot en pausa:** Bandeja → la conversación → **Devolver al bot**.
- **Empezar de cero:** `reset` (A) o **🗑️ Borrar pruebas** + **➕ Nueva conversación** en el Probador (B).

## Qué NO decir (regla 14)

Solo datos medidos por el sistema o por tu **prueba nocturna** (`docs/ventas/prueba-nocturna.md`). Nada de "las clínicas
pierden X %", "0 % de inasistencias" ni promesas de "más pacientes": la garantía está atada a **citas de evaluación
confirmadas** en el reporte.
