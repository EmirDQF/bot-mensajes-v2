# Paridad con los videos de referencia

Videos comparados: `democlinicatop.mp4` (30 s) y `WhatsAppOrthoDemo.mp4` (60 s). Los dos cuentan la misma historia en
7 escenas con la clínica ficticia "Sonrisa Perfecta" (el de 60 s va más lento). Los `.mp4` no van al repositorio
(`.gitignore`).

Cómo se comparó: fotogramas cada 2–3 s de los dos videos contra `npm run demo` con Gemini real, recorriendo el mismo
guion en el Probador (conversación de prueba) e imágenes revisadas con `npm run cards:preview`.

## Antes y después de esta mejora

| # | Escena | Lo que muestra el video | Lo que hacía el bot | Diferencia y cómo quedó |
|---|---|---|---|---|
| 1 | Captura desde Meta Ads | Llega un mensaje de un anuncio de Instagram y el bot saluda por su nombre: "¡Hola Carlos! 😊 … bienvenido a *Clínica Sonrisa Perfecta*" | Bienvenida con logo, campaña y aviso de privacidad, sin el nombre | **Cerrada en parte.** Ahora saluda con el nombre del perfil de WhatsApp si parece real ("¡Hola, Carlos!"). El logo y el aviso de privacidad se quedan: el aviso lo exige la Ley 29733 y el texto de bienvenida se edita en el panel. |
| 2 | Catálogo visual | 2 imágenes de diseño: "Brackets metálicos vs zafiro" (con franja "cuotas desde S/ 150/mes") y "Carillas antes/después" (con guía de color), cada una con su texto, y luego el horario de atención | Ilustraciones simples, sin precio, con espacios vacíos | **Cerrada.** Ilustraciones nuevas con los colores, el logo y el nombre de la clínica, labios, encía y dientes con volumen, brackets metálicos o de zafiro, guía de color y una franja con el precio "desde" y el financiamiento **de la configuración**. Van marcadas como "Imagen referencial". No son fotos realistas: la regla 12 prohíbe fotos de pacientes sin consentimiento. La clínica puede subir sus propias fotos en el panel "Mi clínica". |
| 3 | El paciente pregunta requisitos, días, precio y cómo agendar | Una sola pregunta larga | Igual | Sin diferencia. También se reconoce "¿tengo que llevar…?". |
| 4 | Respuesta al instante | Tarjeta "Pack Evaluación Digital 3D" (arco escaneado, radiografía, checklist, barra de precio) + **un mensaje en bloques**: 📋 *¿Qué necesitas llevar?* · 💰 *Inversión y planes* · 📅 *¿Cómo agendamos?* + 2 horarios en botones, en **días distintos** | Tarjeta básica y un párrafo libre del modelo sin negritas (se borraban los `*`), con 3 horarios del **mismo día** | **Cerrada.** Tarjeta del pack rediseñada: arco escaneado, tira de radiografía, checklist, barra de precio con la promoción y su fecha de fin, colores y logo. El mensaje en bloques se arma con la configuración (qué traer, precio del pack, precios "desde" de los tratamientos que mencionó el paciente, medios de pago si los pregunta) y con horarios libres reales: máximo 2 por día, así se ofrecen al menos 2 días. El video tiene una insignia "SCAN 3D" que no sale de ningún dato; en su lugar va el logo. |
| 5 | Agendar en 1 toque | Toca "Jueves 4:30 p. m." y escribe "Mi nombre completo es Carlos Mendoza" | El botón funcionaba, pero "Mi nombre **completo** es…" no se reconocía como nombre: el modelo decía "tu solicitud … quedó registrada" sin que se guardara nada | **Cerrada (era un bug).** Se reconoce el nombre y se reserva. Además, el freno que impide decir "registrada/confirmada" sin cita guardada ahora detecta "tu solicitud de cita **para ortodoncia** quedó registrada". |
| 6 | Pase de cita + recordatorio + aviso al doctor | Pase de cita con logo y colores, ✓ CONFIRMADA, QR, código SP-0472 y "Recordatorio 48h programado". Texto: "¡Listo, Carlos! 🎉 Tu cita de Evaluación ya quedó **100% confirmada**" con 📅 Día, 👨‍⚕️ Especialista, 📍 Dirección, 🔔 *Para tu tranquilidad…*, ✅ *ya le enviamos tu ficha al doctor* | Pase sencillo; texto corto sin bloques | **Cerrada.** Pase rediseñado: cortes de ticket reales, insignia "✓ CONFIRMADA" con los colores de la clínica, logo, QR solo con el código y línea de recordatorio según la configuración (o nada si están apagados). Texto con el formato del video. "Ya le enviamos tu ficha…" aparece **solo si de verdad se envió** (al doctor o a recepción). Solo en `bookingMode: "confirmacion_directa"`; en "solicitud" (por defecto) dice "solicitud … Recepción te la confirmará" y no hay pase (regla 9). |
| 7 | Alerta al doctor y métricas | Notificación "[ALERTA AL DOCTOR - NUEVA CITA AGENDADA]" con Paciente, Interés, Cita, Recordatorio 48h: PROGRAMADO ✅. Al final, tarjetas "2 seg · 0% intervención humana · Cita asegurada" | Ficha en texto corrido; la plantilla (fuera de las 24 h) era una sola línea | **Cerrada.** Ficha y plantilla `ficha_cita_doctor` con el encabezado y una línea por dato, en negrita. En el Probador aparece como notificación sobre el celular, con el texto exacto que recibe el doctor (también si va por plantilla). Las cifras "2 seg / 0%" del video son edición del video, no del bot: **no se copian** (regla 14). Las métricas reales están en el panel (tiempo de primera respuesta, % sin intervención, citas, asistencias). |

## Lo que el bot hace y el video no muestra

- Después de agendar pregunta **una vez** si quiere recibir promociones (Sí/No, guardado con fecha). Lo exige la Fase
  7 (opt-in) y no se quita.
- Envía la ubicación de la clínica si tiene coordenadas.
- El Probador muestra el texto con el formato de WhatsApp (*negrita*, _cursiva_, ~tachado~), igual que el celular.

## Cómo comprobarlo

1. `npm run cards:preview` → revisa `tmp/cards-denvari/` (pack, pase, catálogo y `ficha-doctor.txt`).
2. `npm run demo` → Probador → envía el guion de `docs/demo-script.md`.
3. Tests: `services/paridadVideo.test.js` (formato, datos solo de la configuración, ficha y plantilla, nombre,
   imágenes con colores y precios reales).
