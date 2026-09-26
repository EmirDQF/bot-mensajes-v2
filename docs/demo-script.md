# Guion de demo — 60 segundos (Clínica Dental Denvari)

**Mensaje de venta en una frase:** "Mientras tu clínica duerme, tu recepcionista de WhatsApp capta, agenda y
recuerda a los pacientes que llegan por tus anuncios."

## Antes de grabar (5 minutos)

- [ ] `ACTIVE_CLINIC=denvari` y el bot desplegado con su número de WhatsApp de pruebas.
- [ ] Tu número personal en `RECEPTION_ALERT_PHONE` (y `OWNER_ALERT_PHONE`): la alerta te llegará a ti.
- [ ] Migraciones ejecutadas en Supabase (`appointments` y `follow_ups`).
- [ ] Un **segundo teléfono** (o WhatsApp Web) que hará de paciente, con la conversación borrada:
      escribe `reset` desde ese número para empezar como contacto nuevo.
- [ ] Grabación de pantalla con **dos ventanas lado a lado**: izquierda el chat del paciente, derecha tu WhatsApp
      (recepción) y, al final, el panel `/panel` en la pestaña **Agenda**.
- [ ] Reloj visible del teléfono o de la pantalla marcando la noche (idealmente grabar ~10:30 p. m.).

## Guion

| Seg. | En pantalla | Qué escribe el "paciente" | Qué dices (voz en off) |
|---|---|---|---|
| 0–8 | Chat vacío, reloj en **10:30 p. m.** | "Hola, vi su anuncio de brackets" | "Son las 10:30 de la noche. La clínica está cerrada, pero llega un lead de Meta Ads." |
| 8–15 | Llega el **logo de Denvari** con la bienvenida y el aviso de privacidad | — | "En segundos responde Camila, con la marca de la clínica y el aviso de datos personales." |
| 15–25 | Camila explica precio "desde" y financiamiento; llega la **foto de ortodoncia** | "¿Cuánto cuestan los bravkets? ¿Tienen fotos?" | "Responde precios reales de la clínica y envía las fotos sola. Escribí 'bravkets' mal y lo entendió igual." |
| 25–35 | Aparecen **3 horarios concretos** numerados 1️⃣ 2️⃣ 3️⃣ | "Quiero una cita" | "No pregunta '¿qué día?': ofrece tres horarios libres reales de la agenda." |
| 35–43 | "¡Listo, Ana Torres! Tu solicitud de cita para Ortodoncia el … quedó registrada en … Recepción te la confirmará." | "Me llamo Ana Torres, la 2" | "El paciente elige con un número. La solicitud queda registrada." |
| 43–50 | En **tu** WhatsApp: "🦷 Nueva solicitud de cita — Clínica Dental Denvari" con nombre, tratamiento, horario y link wa.me | — | "Y recepción recibe la alerta al instante, lista para confirmar a primera hora." |
| 50–56 | Panel `/panel` → **Agenda** → **Mañana**: la cita de Ana con botones Confirmar / Asistió / No asistió | — | "Todo queda en el panel de recepción, con métricas de cuántas citas trae cada anuncio." |
| 56–60 | **Recordatorio** en el chat del paciente: "Responde 1️⃣ Confirmo 2️⃣ Reprogramar" | — | "Y el día anterior le recuerda la cita solo. Menos no-shows, cero horas de recepción." |

## Cómo mostrar el recordatorio sin esperar 24 horas

Agenda la cita de la demo para **mañana temprano** (entre 2 y 24 horas desde ahora) y dispara el job a mano:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" "$BOT_URL/jobs/reminders"
```

Como el paciente escribió hace minutos, el recordatorio sale como texto libre (no necesita plantilla aprobada).

## Plan B si algo falla en vivo

- **No llega la alerta a recepción:** revisa que `RECEPTION_ALERT_PHONE` esté definido (al arrancar, el log avisa si falta).
- **"Falta la tabla appointments" en el panel:** ejecuta `migrations/20260925_create_appointments.sql`.
- **El bot no responde:** puede estar en pausa por un "hablar con una persona" anterior → en el panel, botón **Reactivar bot**.
- **Empezar de cero:** escribe `reset` desde el teléfono del paciente.

## Cierre comercial (después del video)

1. "¿Cuántos mensajes de tus anuncios llegan fuera de horario?" → el **resumen diario de las 8:00 a. m.** lo cuenta.
2. "¿Cuántos pacientes no llegan a su cita?" → recordatorio 24 h + 2 h con confirmación.
3. "Tu clínica en 5 minutos": se crea un archivo de configuración con tus datos, fotos y horarios; sin programar.
