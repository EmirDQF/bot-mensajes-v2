# Guion del video de demo — 60 a 90 segundos

**En una frase:** "Tu asistente de WhatsApp atiende a los pacientes de tus anuncios a cualquier hora: les muestra el
tratamiento con imágenes, les da los precios reales, les ofrece horarios en botones, les entrega su pase de cita y te
avisa a ti y al doctor."

Es el mismo guion de los videos de referencia `democlinicatop.mp4` y `WhatsAppOrthoDemo.mp4` (comparación escena por
escena en `docs/paridad-video.md`). Dos versiones:

- **(A) REAL** (una vez desplegado): pantalla dividida con **WhatsApp Web** (tu celular hace de paciente) | el panel.
- **(B) DEMO** (sin Meta): el **🧪 Probador** en tu computadora, con Gemini real, pacientes inventados y WhatsApp
  simulado. Con la clínica ficticia Denvari o con **la clínica de un prospecto** (sección siguiente).

## Video de un prospecto en 5 minutos (B)

1. **Sus datos (2 min):** nombre, dirección, horario, precios "desde", campaña de su anuncio (Meta Ad Library), colores
   y logo (de su Facebook o su web). Ponlos en un `prospecto.json` (ejemplo en `docs/ventas/demo-rapida.md`).
2. **Genera su demo (~2 s):** `npm run quick-demo -- prospecto.json`. Abre `tmp/cards-demo-<nombre>/` y mira el pack,
   el pase y el catálogo con sus colores. Si algo se ve mal, corrige el JSON, borra `config/clinics/demo-<nombre>.js`
   y vuelve a generarla.
3. **Arranca:** `npm run demo:video -- demo-<nombre>`. Abre el enlace que imprime (`/panel?video=1#tester`) y entra
   con el usuario `demo` y la contraseña que muestra. La hora ya está en 🌙 10:30 p. m.
4. **Graba (1 min):** activa la grabación de pantalla (Windows: `Win + Alt + R` con la Xbox Game Bar, o Recortes →
   Grabar) sobre el celular del Probador. Pulsa **🎬 Siguiente línea** y Enter en cada paso; en el paso 3 toca un
   horario.
5. **Envíaselo** con tu mensaje (`docs/ventas/mensajes-contacto.md`). Al cerrar la consola, todo se borra (memoria).

## Antes de grabar

**(B) Demo**
- [ ] `GEMINI_API_KEY` en tu `.env` (sin ella el bot responde con textos fijos de respaldo, menos naturales).
- [ ] `npm run demo:video -- <id>` (prospecto) o `npm run demo:video -- denvari` (clínica ficticia). Las alertas van a
      números falsos que no existen: no necesitas `DOCTOR_ALERT_PHONE` ni ningún teléfono real.
- [ ] La demo ya viene en **confirmación directa** (para que salga el pase de cita).
- [ ] En pantalla, un aviso fijo: **"Datos de demostración · pacientes inventados"**.

**(A) Real**
- [ ] `npm run smoke:prod -- TU-URL` en ✅ y `npm run meta:check` sin ❌ (token PERMANENTE).
- [ ] Conversación limpia: escribe `reset` desde tu celular al bot.
- [ ] Para mostrar el pase de cita: Mi clínica → 🤖 Asistente → **Confirmación directa** (solo si la Agenda del panel es
      la única de la clínica; con un número de prueba no hay problema).
- [ ] Para la ficha del doctor: `DOCTOR_ALERT_PHONE` en Render con un número tuyo de prueba.

## Guion (las 7 escenas del video)

| # | Paciente (Probador: "🎬 Siguiente línea") | Lo que se ve | Voz en off |
|---|---|---|---|
| 1 | "Hola! Vi su anuncio en Instagram y me interesa mucho. Quiero mejorar mi sonrisa, ¿me dan información de ortodoncia o carillas por favor?" | Bienvenida con su nombre ("¡Hola, Carlos!"), el logo, el aviso de clínica cerrada y el de privacidad | "Llega un paciente de un anuncio a las 10:30 p. m. y lo atienden al instante." |
| 2 | — | Las imágenes **"Brackets metálicos vs zafiro"** y **"Carillas antes y después"** (colores y precios "desde" de la clínica, "Imagen referencial") y la respuesta con horarios en **botones** | "Le muestra el tratamiento con imágenes y precios reales, nunca inventados." |
| 3–4 | "Qué buenas fotos! … ¿tengo que llevar radiografías o algo especial? ¿Qué necesito, qué días tienen espacio, cuánto cuesta empezar y cómo agendo?" | La **tarjeta del pack** y un mensaje en bloques: 📋 *¿Qué necesitas llevar?* · 💰 *Inversión y planes* · 📅 *¿Cómo agendamos?*, con horarios en al menos 2 días distintos | "Resuelve todo de una: requisitos, precio para empezar y horarios libres reales." |
| 5 | Toca un **botón de horario**; luego "Mi nombre completo es Carlos Mendoza." | Le pide el nombre completo y reserva | "Agenda con un toque." |
| 6 | — | El **pase de cita** (logo, colores, ✓ CONFIRMADA, código y QR) y "¡Listo, Carlos! 🎉 Tu cita de evaluación ya quedó *100% confirmada*" con día, especialista, dirección, código y recordatorio 48 h y 2 h antes | "Recibe su pase. El QR solo lleva el código, ningún dato personal." |
| 7 | "¡Genial, muchas gracias! …" | La **alerta al doctor** aparece como notificación arriba del celular: paciente, interés, cita y recordatorio programado. El bot también pregunta una vez si quiere recibir promociones | "El doctor recibe la ficha al instante, sin diagnósticos." |
| Cierre | — | Pestaña **📊 Métricas** (primera respuesta, % sin intervención humana, citas confirmadas y asistencias) y la oferta | "Y tú ves los números que mide el sistema, no promesas." |

**Lo que el video de referencia muestra y aquí NO se copia (dilo así si te preguntan):**
- Las tarjetas "2 seg · 0% intervención humana · Cita asegurada" son edición de video: el bot no inventa cifras. Muestra
  las métricas reales del panel.
- Las fotos realistas de dientes: el catálogo usa ilustraciones marcadas "Imagen referencial" (nunca fotos de
  pacientes sin consentimiento). La clínica puede subir sus propias fotos en Mi clínica.
- La tarjeta del anuncio de Instagram solo aparece en WhatsApp real (A), no en el Probador.
- Los recordatorios no se ven en vivo: la ficha los muestra como "programado".

**Oferta y garantía (igual que `docs/ventas/propuesta.md`):** S/ 400 al conectar + S/ 400 si en los 7 días siguientes
el reporte del sistema muestra al menos 2 citas de evaluación confirmadas (o asistidas). Si no, se devuelven los S/ 400
pagados al conectar. Condición: la clínica mantiene su **pauta activa en Meta durante los 7 días** y recepción marca
las solicitudes en el panel.

## Plan B si algo falla

- **No responde (A):** `npm run meta:check`. Si dice **TOKEN DE WHATSAPP VENCIDO**, cambia el token (`docs/go-live.md`).
  Mientras, graba la versión (B).
- **Responde con textos fijos (B):** falta `GEMINI_API_KEY` o Gemini está saturado; el catálogo, el pack, los botones y
  el pase funcionan igual.
- **La respuesta varía entre tomas:** es la IA real; si una toma sale rara, **➕ Nueva conversación** y repite.
- **Bot en pausa:** Bandeja → la conversación → **Devolver al bot**.
- **Empezar de cero:** `reset` (A) o **🗑️ Borrar pruebas** + **➕ Nueva conversación** en el Probador (B).

## Qué NO decir (regla 14)

Solo datos medidos por el sistema o por tu **prueba nocturna** (`docs/ventas/prueba-nocturna.md`). Nada de "las clínicas
pierden X %", "0 % de inasistencias" ni promesas de "más pacientes": la garantía está atada a **citas de evaluación
confirmadas** en el reporte.
