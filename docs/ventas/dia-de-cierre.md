# Día de cierre — miércoles 4 de noviembre de 2026 (Lima)

Meta del día: **1 clínica paga S/ 400 por Yape/Plin.** Es `plan-7-dias.md` comprimido en una tarde. Todo número que
digas sale de lo que **tú mides hoy** (regla 14): hora de tu mensaje, minutos hasta la respuesta y tu captura.

## Horario (ajusta la hora de inicio; los bloques son lo que importa)

| Hora | Bloque | Resultado |
|---|---|---|
| 12:00–12:15 | **Preparación.** `GEMINI_API_KEY` en Render (ver resumen de Fase 2). Panel de producción abierto en el celular, Probador listo en 🌙 10:30 p. m. (`demo-rapida.md`). Yape/Plin con saldo visible y QR a mano. | Demo lista en el bolsillo |
| 12:15–12:45 | **Prospección manual** en la Biblioteca de anuncios (abajo). | 15–20 filas en `prospectos.csv` |
| 12:45–13:15 | **Prueba de día:** escribe como paciente a las 15–20, una por una, con la pregunta de **su** anuncio. Anota `hora_prueba`. | 15–20 mensajes enviados |
| 13:15–14:00 | Almuerzo + **revisa respuestas** cada 15 min: `respondio` (Sí / Autorespuesta / No), `minutos_respuesta`, captura. | La evidencia de hoy |
| 14:00–14:20 | **Elige la ruta:** las que tardaron más de 30 min, solo respondieron con autorespuesta o no respondieron, agrupadas en **máx. 2 distritos cercanos**. Ordénalas por cercanía. Arma su demo personalizada para las 2 mejores (`npm run quick-demo`, 5 min cada una). | Ruta de 5–6 clínicas |
| 14:20–14:40 | **Mensajes por WhatsApp personal**, uno por uno, a las que no vas a visitar (plantilla abajo). | 5–8 enviados |
| 14:40–18:30 | **Visitas** con el guion de mostrador. 20–30 min por clínica incluyendo traslado. | ≥ 2 demos con el director o el administrador |
| 18:30–20:00 | **Seguimiento** de los mensajes de las 14:20 (contesta en el momento) y visitas de la segunda tanda (muchos directores llegan en la tarde). | ≥ 1 "sí" |
| 20:00–21:00 | **Cobro y arranque** con quien aceptó (abajo). Si nadie pagó, deja todo listo para el plan B. | S/ 400 cobrados o plan B listo |

## 1. Prospección (30 min, manual)

1. Abre `facebook.com/ads/library` → País: **Perú** → Categoría: **Todos los anuncios** → estado **Activos**.
2. Busca una por una: `brackets`, `ortodoncia`, `implantes dentales`, `diseño de sonrisa`, y combina con distritos:
   `brackets surco`, `implantes miraflores`, `ortodoncia los olivos`…
3. Quédate solo con anuncios que **llevan a WhatsApp** ("Enviar mensaje"). Anota en `prospectos.csv`: `clinica`,
   `distrito`, `anuncio_tema`, `anuncio_link` (botón "Ver detalles del anuncio") y la oferta exacta del anuncio en `notas`.

Solo búsqueda manual en la web: nada de scraping ni la API de la Biblioteca (fuera de la UE solo cubre anuncios políticos).

## 2. Prueba de día (la evidencia)

- Escríbeles desde tu número como **paciente real**, con la pregunta de su propio anuncio: *"Hola, vi su anuncio de
  brackets con inicial S/ 0, ¿cuánto sería la mensualidad?"*.
- Anota la hora exacta (`hora_prueba`, `dd/mm hh:mm`) y haz **captura** al llegar la respuesta (o a las 2 h sin ella).
- Clasifica: **respondió** (minutos), **autorespuesta** (y si después alguien contestó), **nada**.
- No inventes nada al contarlo: "le escribí a las 12:52 y me respondieron a las 14:10" es lo único que vale.

## 3. Guion de mostrador (60 s) — objetivo: 5 minutos con el director o el administrador

> "Buenas tardes, soy [nombre]. Hoy a las [12:52] les escribí por WhatsApp como paciente por su anuncio de [brackets]
> y [la respuesta llegó a las 14:10 / solo llegó un mensaje automático / todavía no me responden] — aquí está la
> captura. No vengo a criticar: su anuncio funciona, la gente escribe. Traigo algo que responde a esos pacientes en
> segundos, también de noche, con sus precios, y le deja a recepción la solicitud de cita lista. ¿El doctor o el
> administrador me puede dar 5 minutos? Se lo muestro en el celular con su propio anuncio."

Si no está: pide su WhatsApp directo y la hora en que llega. Deja tu número escrito. Nada de folletos con cifras.

En los 5 minutos: `demo-rapida.md` (opción 2 si armaste su demo, si no la opción 1). Que **el doctor** escriba.

## 4. Mensaje por WhatsApp personal (uno por uno, nunca masivo)

> "Hola Dr./Dra. [Apellido], soy [nombre]. Hoy a las [hora] le escribí a su clínica como paciente por su anuncio de
> [tema] y [la respuesta tardó X min / solo llegó una autorespuesta / aún no responden] (le adjunto la captura).
> Armé un asistente de WhatsApp que responde a esos pacientes en segundos, también de noche, con sus precios, y
> deja la solicitud de cita lista para su recepción. ¿Le muestro en 5 minutos cómo respondería a su anuncio? Puedo
> pasar hoy por la clínica o por videollamada."

Adjunta **su** captura. Un solo seguimiento mañana si no responde.

## 5. Cierre y cobro (en el momento)

**La oferta:** S/ 400 hoy para empezar la instalación + S/ 400 **solo si** en los 7 días siguientes a la conexión su
recepción confirma **2 citas de evaluación** que llegaron por el asistente. Si no, le devuelvo los S/ 400. Lo mide el
reporte del sistema (pestaña Reporte: "✅ cumplido" o "⏳ pendiente").

**Qué decir para pedir el pago:**
> "Si le parece bien, empezamos hoy mismo: son S/ 400 por Yape o Plin a este número, a nombre de [tu nombre]. Le dejo
> el acuerdo por escrito con la garantía de devolución y mañana a primera hora empiezo con sus datos."

- Muestra tu **QR de Yape/Plin** y di el nombre exacto que le aparecerá. Espera a ver la constancia en **tu** app
  antes de irte (no basta una captura del pagador).
- Mándale por WhatsApp, en el momento, la constancia + el acuerdo (`acuerdo-servicio.md`) para firmar.
  ⚠️ El acuerdo hoy dice "S/ 400 **al conectar**": ajústalo a "**al aceptar** (adelanto)" antes de enviarlo.
- Límites diarios de Yape/Plin: **VERIFICAR** en tu app antes de salir.

**Qué pedir ahí mismo** (lista en `../onboarding-cliente.md`):
1. **Logo** (PNG) y fotos de fachada; fotos de pacientes solo con consentimiento escrito.
2. **Precios "desde"** de cada tratamiento y la **campaña** vigente del anuncio.
3. **Horario** por día y feriados en que cierra.
4. **FAQ**: costo de la evaluación, medios de pago, ¿atienden niños?, estacionamiento.
5. **Acceso a Meta Business** (te agrega como socio o administrador), estado de la **verificación del negocio**,
   el **número** que usará y una **tarjeta** en Meta para las plantillas (las paga la clínica a Meta).
6. Número de **recepción** (alertas) y del **dueño** (reporte semanal).

## 6. Las 5 objeciones más probables hoy (2 líneas cada una; más en `objeciones.md`)

1. **"Ya tenemos un bot."** — "¿Le puedo hacer la misma prueba que le hice hoy? Le escribí a las [hora] y [esto pasó].
   Este no es un menú de botones: responde lo que preguntó el paciente, con sus precios, y le deja la cita pedida."
2. **"Ya tengo recepcionista."** — "Es para ella: la cubre de noche, domingos y cuando atiende en persona. A primera
   hora encuentra las solicitudes listas y las confirma; las urgencias se las pasa de inmediato."
3. **"Es caro."** — "Son S/ 400 para empezar; los otros S/ 400 solo si en 7 días hay 2 citas de evaluación confirmadas,
   si no le devuelvo los S/ 400. Con su precio de [ortodoncia] de S/ [X], una sola cita cerrada lo paga."
4. **"¿Y si falla o responde mal?"** — "No diagnostica ni promete: si duda, pasa a una persona. Si la IA no responde, el
   paciente igual recibe horarios y su recepción un aviso. Usted lo prueba en su celular antes de pagar el resto."
5. **"Déjame pensarlo."** — "Claro. Esta noche a las 10:30 escríbale usted mismo a su WhatsApp como paciente y mire qué
   pasa. Mañana a las 9 le escribo y me cuenta."

## 7. Plan B si nadie paga hoy

- **22:00–23:00 — prueba nocturna** (`prueba-nocturna.md`): escribe a las clínicas visitadas y a 5 nuevas la pregunta
  de su anuncio. Anota hora y captura. Es la evidencia más fuerte: el diferencial del producto es la noche.
- **Jueves 9:00 a. m.:** anota quién respondió y cuándo. Escribe a los directores que viste hoy, con **su** captura
  nocturna: "Anoche a las 10:41 le escribí como paciente y [la respuesta llegó a las 8:15]. ¿Le muestro hoy cómo habría
  respondido el asistente?" Un solo mensaje por director.
- Actualiza `estado` en `prospectos.csv` (`prueba_hecha`, `contactado`, `reunion`, `descartado` con motivo).
