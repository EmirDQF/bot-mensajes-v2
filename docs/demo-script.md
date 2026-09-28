# Guion de demo — 90 segundos

**En una frase:** "Mientras tu clínica duerme, tu asistente de WhatsApp atiende a los pacientes que llegan por tus
anuncios, les recomienda una evaluación sin diagnosticar, deja la solicitud de cita lista para recepción y tú lo ves
todo en vivo."

Dos versiones con el **mismo guion**:

- **(A) REAL — la preferida** una vez desplegado: pantalla dividida con **WhatsApp Web** (tu celular hace de paciente y
  escribe al número del bot) | la **Bandeja en vivo** en `TU-URL/panel`.
- **(B) RESPALDO — sin Meta**: `npm run demo` en tu computadora, pantalla dividida con el **🧪 Probador** | la
  **Bandeja**. Mismos pasos y la misma asistente (Gemini real), con pacientes inventados y WhatsApp simulado.

## Antes de grabar (5 min)

**(A) Real**
- [ ] `npm run smoke:prod -- TU-URL` en ✅ y `npm run meta:check` sin ❌ (token **PERMANENTE**).
- [ ] Tu celular está en la lista "Para" de Meta (si usas el número de prueba) y `RECEPTION_ALERT_PHONE` es un número
      que puedas mostrar (la alerta llega ahí).
- [ ] Conversación limpia: escribe `reset` desde tu celular al bot.
- [ ] Ventana izquierda: <https://web.whatsapp.com> con el chat del bot. Derecha: `TU-URL/panel` como **dueño**
      (`PANEL_OWNER_USER`), pestaña **Bandeja**, con sonido y notificaciones activados.
- [ ] Graba de noche (~10:30 p. m.) con el reloj de la pantalla visible: el 🌙 sale de la hora real.

**(B) Respaldo**
```bash
npm run demo
```
- [ ] Abre `http://localhost:3000/panel` y entra como dueño (`PANEL_OWNER_USER`/`PANEL_OWNER_PASSWORD` de tu `.env`;
      si no están, la consola muestra un usuario `demo` y una contraseña de un solo uso).
- [ ] Ventana izquierda: pestaña **🧪 Probador** → hora **🌙 10:30 p. m.** → **➕ Nueva conversación**.
      Derecha: otra ventana del panel en **Bandeja**.

## Guion (90 s)

| Seg. | Paciente (WhatsApp Web / Probador) | En el panel | Voz en off |
|---|---|---|---|
| 0–10 | Reloj en **10:30 p. m.** Tres mensajes seguidos: "hola" / "vi su anuncio de brackets" / "cuánto es la inicial" | La conversación sube arriba con **🌙** y "Bot escribiendo…" | "10:30 de la noche, la clínica cerrada, y llega un paciente de un anuncio. Escribe tres mensajes seguidos…" |
| 10–25 | Llega **UNA sola respuesta**: bienvenida con el logo, precio "desde" y la inicial de la campaña; luego las **fotos** | Las burbujas del bot aparecen al instante | "…y la asistente espera, junta los tres y responde una sola vez, con los precios reales de la clínica y fotos." |
| 25–40 | "tengo los dientes chuecos" → "por lo que me cuentas, lo indicado es una **evaluación** de ortodoncia; el doctor confirma el mejor tratamiento" + precio "desde" + **3 horarios** | Badge **🔥 caliente** en la conversación | "No diagnostica: recomienda una evaluación, como la mejor recepcionista, y ofrece tres horarios libres reales." |
| 40–50 | "la 2, soy Ana Torres" → "Tu **solicitud de cita** … Recepción te la confirmará." | **📅** en la conversación y la solicitud en **Agenda**; en (A) llega la alerta al WhatsApp de recepción | "Elige con un número. Queda la solicitud en la agenda y recepción recibe la alerta al instante." |
| 50–60 | — | Recepción pulsa **Intervenir** y escribe "Hola Ana, soy Rosa de recepción 😊" → el bot queda en pausa (**👤**) | "Si recepción quiere tomar la conversación, un clic: el bot se pausa y responde una persona." |
| 60–75 | Tras **Devolver al bot**: "¿cuánto cuesta el blanqueamiento?" → responde con el **precio nuevo** | **⚙️ Configuración** → 🦷 Tratamientos → cambia el precio "desde" del blanqueamiento (o 🎁 una promoción) → **Guardar** | "El dueño cambia un precio o una promoción desde el panel, sin programar, y la asistente lo usa en el siguiente mensaje." |
| 75–85 | — | Pestaña **Reporte**: conversaciones fuera de horario, solicitudes, confirmadas y **garantía ✅** | "Cada semana, un reporte con lo que midió el sistema: lo que llegó de noche y las citas confirmadas." |
| 85–90 | Pantalla final con la oferta | — | "**S/ 800: S/ 400 al conectar y S/ 400 solo si en 7 días el reporte muestra 2 citas de evaluación confirmadas.**" |

> La garantía ✅ del Reporte en (B) sale de los pacientes inventados de la demo. En (A) aparece recién cuando haya
> citas confirmadas reales: para el video de (A) muestra el Reporte de la demo (B) y dilo así ("así se ve el reporte").
> Al terminar (A), pulsa **Devolver al bot** en la conversación para dejarla como estaba.

## Versión personalizada por prospecto (3 min)

Muestra al director **su** clínica, sin tocar código ni producción:

1. `npm run demo` → entra como dueño → **⚙️ Configuración**.
2. **🤖 Clínica y asistente:** nombre de **su** clínica (y de la asistente). **📍 Dirección…:** su dirección y su
   **logo** (descárgalo de su página de Facebook). **🎨 Colores:** los de su logo. **🦷 Tratamientos:** sus precios
   "desde" (de su anuncio o su web; si no los publica, deja los de la demo y dilo). **🎁 Campaña:** la del anuncio que
   viste en Meta Ad Library. **Guardar** en cada sección.
3. **🧪 Probador** → 🌙 10:30 p. m. → graba el guion (B) y envíaselo con tu mensaje (`docs/ventas/mensajes-contacto.md`).

Todo queda en el Supabase **en memoria** de la demo: al cerrar `npm run demo` se borra y no toca a ningún cliente real.
Cuando firme: `npm run new-clinic -- <id> "<Nombre>"` (`docs/onboarding-cliente.md`).

## Plan B si algo falla en vivo

- **No responde (A):** `npm run meta:check`. Si dice **TOKEN DE WHATSAPP VENCIDO** (o el panel muestra el banner rojo),
  cambia el token (`docs/go-live.md`). Mientras, graba la versión (B).
- **Bot en pausa:** Bandeja → la conversación → **Devolver al bot**.
- **Empezar de cero:** `reset` desde el celular (A) o **🗑️ Borrar pruebas** + **➕ Nueva conversación** en el Probador (B).
- **No llega la alerta a recepción (A):** con el número de prueba, `RECEPTION_ALERT_PHONE` debe estar en la lista "Para".

## Qué NO decir (regla 14)

Solo datos medidos por el sistema o por tu **prueba nocturna** (`docs/ventas/prueba-nocturna.md`). Nada de "las clínicas
pierden X %" ni promesas de "más pacientes": la garantía está atada a **citas de evaluación confirmadas** en el reporte.
