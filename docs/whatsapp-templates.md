# Plantillas de WhatsApp para aprobar en Meta

WhatsApp solo permite texto libre dentro de las **24 horas** siguientes al último mensaje del paciente.
Fuera de esa ventana, el bot usa estas plantillas **por nombre** (ver `config/whatsappTemplates.js`).
Si Meta aprueba un nombre distinto, cámbialo en ese archivo o con la variable `WA_TEMPLATE_*` indicada.

**Dónde crearlas:** Meta Business Suite → WhatsApp Manager → Administrar plantillas → Crear plantilla.
Idioma: **Español (es)**. Copia el cuerpo tal cual: las variables `{{1}}`, `{{2}}`… deben quedar en el mismo orden.

> Reglas de Meta que ya cumplen estos textos: las variables no van al inicio ni al final del cuerpo, no hay
> dos variables seguidas y el texto tiene contexto suficiente. Los valores que envía el bot nunca llevan saltos de línea.

---

## 1. `recordatorio_cita_24h` — Categoría: **Utilidad**

Variable de entorno para otro nombre: `WA_TEMPLATE_REMINDER_24H`

**Cuerpo:**

```
Hola {{1}} 👋 Te recordamos tu cita en {{2}} para {{3}} el {{4}} a las {{5}}. 📍 Dirección: {{6}}. ¿Nos confirmas tu asistencia?
```

**Botones (respuesta rápida):** `Confirmo` · `Reprogramar`

**Ejemplos para la revisión de Meta:** {{1}} Ana · {{2}} Clínica Dental Denvari · {{3}} Limpieza dental · {{4}} martes, 29 de setiembre · {{5}} 10:00 a. m. · {{6}} Calle Las Orquídeas 450, San Isidro

Qué hace el bot con la respuesta: "Confirmo" (o "1") → la cita pasa a `confirmada` y se avisa a recepción; "Reprogramar" (o "2") → ofrece 3 horarios nuevos.

---

## 2. `recordatorio_cita_2h` — Categoría: **Utilidad**

Variable de entorno para otro nombre: `WA_TEMPLATE_REMINDER_2H`

**Cuerpo:**

```
Hola {{1}}, tu cita en {{2}} es hoy a las {{3}}. 📍 Dirección: {{4}}. Si no podrás llegar, toca Reprogramar y te ofrecemos otro horario.
```

**Botones (respuesta rápida):** `Confirmo` · `Reprogramar`

**Ejemplos:** {{1}} Ana · {{2}} Clínica Dental Denvari · {{3}} 10:00 a. m. · {{4}} Calle Las Orquídeas 450, San Isidro

---

## 3. `reactivacion_paciente` — Categoría: **Marketing**

Variable de entorno para otro nombre: `WA_TEMPLATE_REACTIVATION`

Se usa para el mensaje de retoma cuando el lead ya salió de la ventana de 24 h (normalmente el seguimiento de las 20 h va como texto libre y no la necesita).

**Cuerpo:**

```
Hola 👋 Te escribimos de {{1}}. Seguimos con nuestra campaña: {{2}}. ¿Quieres que te propongamos 3 horarios para tu evaluación? Responde "quiero una cita".
```

**Botón (respuesta rápida):** `Quiero una cita`

**Ejemplos:** {{1}} Clínica Dental Denvari · {{2}} Evaluación digital 3D sin costo y Cuota inicial S/ 0

---

## 4. `solicitud_resena` — Categoría: **Marketing**

Variable de entorno para otro nombre: `WA_TEMPLATE_REVIEW`

Para pedir una reseña de Google después de una cita marcada como **asistió** en el panel.

**Cuerpo:**

```
¡Gracias por visitarnos, {{1}}! 🦷 En {{2}} nos ayudaría mucho conocer tu opinión. Déjanos tu reseña aquí: {{3}} ¡Gracias por tu tiempo!
```

**Ejemplos:** {{1}} Ana · {{2}} Clínica Dental Denvari · {{3}} https://g.page/r/tu-clinica/review

---

## 5. `resumen_diario` — Categoría: **Utilidad**

Variable de entorno para otro nombre: `WA_TEMPLATE_DAILY_SUMMARY`

Resumen de las 8:00 a. m. para el dueño (`OWNER_ALERT_PHONE`) cuando no le ha escrito al bot en las últimas 24 h.

**Cuerpo:**

```
📊 Resumen del {{1}}. Consultas fuera de horario: {{2}}. Citas creadas: {{3}}. Citas para hoy: {{4}}. Leads sin agendar: {{5}}. Anuncio con más citas: {{6}}. Citas solicitadas con la clínica cerrada: {{7}}. Revisa el detalle en tu panel.
```

**Ejemplos:** {{1}} lunes, 28 de setiembre · {{2}} 7 · {{3}} 4 · {{4}} 6 · {{5}} 3 · {{6}} Brackets S/ 0 (2 citas) · {{7}} 2

---

## 6. `reporte_semanal` — Categoría: **Utilidad**

Variable de entorno para otro nombre: `WA_TEMPLATE_WEEKLY_REPORT`

Reporte del lunes a las 8:00 a. m. para el dueño (`OWNER_ALERT_PHONE`), con la línea de la garantía de 7 días.
Si el dueño le escribió al bot en las últimas 24 h, llega como texto con todo el detalle (urgencias, reprogramaciones,
valor potencial y anuncio con más citas).

**Cuerpo:**

```
📈 Reporte semanal del {{1}}. Conversaciones: {{2}} ({{3}} fuera de horario). Citas solicitadas: {{4}}. Confirmadas: {{5}}. Garantía: {{6}}. Revisa el detalle e imprime el reporte en tu panel, pestaña Reporte.
```

**Ejemplos:** {{1}} lunes, 21 de setiembre al domingo, 27 de setiembre · {{2}} 34 · {{3}} 14 · {{4}} 9 · {{5}} 5 · {{6}} Citas de evaluación confirmadas: 5 / meta 2 → ✅ cumplido

---

## Cómo probar sin esperar la aprobación

Mientras las plantillas están en revisión, escríbele al bot desde tu número personal (el que pusiste en
`RECEPTION_ALERT_PHONE` / `OWNER_ALERT_PHONE`): así quedas dentro de la ventana de 24 h y los recordatorios,
el resumen y el seguimiento llegan como texto libre.

## Cron jobs (cron-job.org)

La tabla completa, con método, URL, header y horario de cada tarea, está en `docs/deploy.md` (paso 4).
Todas las tareas `/jobs/*` son `POST` con el header `x-cron-secret: <CRON_SECRET>`. Horas en UTC (Lima = UTC−5).

| Job | URL | Frecuencia | Cron (UTC) |
|---|---|---|---|
| Recordatorios 24 h / 2 h | `/jobs/reminders` | cada 15 min | `*/15 * * * *` |
| Resumen diario 8:00 a. m. Lima | `/jobs/daily-summary` | diario | `0 13 * * *` |
| Seguimiento a las 20 h | `/jobs/follow-ups` | cada hora | `0 * * * *` |
| Reporte semanal (lunes 8:00 a. m. Lima) | `/jobs/weekly-report` | lunes | `0 13 * * 1` |

Comando de ejemplo para un Render Cron Job:

```
curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" "$BOT_URL/jobs/reminders"
```
