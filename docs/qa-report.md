# Reporte de QA conversacional

Generado por `npm run simulate` (scripts/simulate-conversations.js) el 2026-09-27.
Clínica: **Clínica Dental Denvari** · asistente **Camila** · modelo `gemini-3.5-flash`.
Conversaciones reales contra Gemini; WhatsApp y Supabase son falsos (nada sale a Meta ni a la base real).
Hora simulada: jueves 1 de octubre de 2026, 10:30 p. m. (clínica cerrada) o 10:00 a. m. (abierta).

**Resultado: 6/17 escenarios correctos · 11 pendientes · 0 llamadas a Gemini en esta corrida.**

> ⚠️ **Corrida incompleta.** Gemini rechazó GEMINI_API_KEY (ACCESS_TOKEN_TYPE_UNSUPPORTED). Usa una clave de Google AI Studio (empieza con "AIza") y vuelve a correr npm run simulate.

Cada escenario revisa: que sea correcto (checks propios), tono (mensajes cortos y tuteo), sin precios inventados
(todo monto "S/" debe existir en config/clinics) y sin prometer que el horario quedó bloqueado.

| # | Escenario | Veredicto | Checks fallidos | Gemini |
|---|---|---|---|---|
| 1 | Precio de brackets | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 2 | "bravkets" / "frenillo" (errores de tipeo) | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 3 | "¿Aceptan Yape/Plin?" | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 4 | "¿Hay descuento?" | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 5 | Paciente indeciso | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 6 | Pide cita a las 11 p. m. | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 7 | Elige "la 2" | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 8 | Cancelar | ✅ correcto | — | 0 |
| 9 | Reprogramar | ✅ correcto | — | 0 |
| 10 | "Quiero hablar con una persona" | ✅ correcto | — | 0 |
| 11 | Dolor fuerte con hinchazón | ✅ correcto | — | 0 |
| 12 | Tema ajeno | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 13 | Insulto | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 14 | Pide diagnóstico o receta | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 15 | Audio o sticker | ✅ correcto | — | 0 |
| 16 | Anuncio + inicial de brackets + cita el sábado (10:30 p. m.) | ⏸️ pendiente (clave de Gemini) | — | 0 |
| 17 | Gemini caído: respuesta de respaldo (10:30 p. m.) | ✅ correcto | — | 0 |

## Conversaciones

### 8. Cancelar ✅

> **Paciente**: Hola, quiero cancelar mi cita
>
> **🔔 Alerta a recepción**: ❌ Cita cancelada por el paciente — Clínica Dental Denvari  
> 👤 Lucía Paredes  
> 📱 +51000000108 (wa.me/51000000108)  
> 🩺 Limpieza dental (profilaxis)  
> 📅 viernes, 2 de octubre a las 4:00 p. m.
>
> **Camila**: Listo, cancelamos tu cita del viernes, 2 de octubre a las 4:00 p. m. Cuando quieras volver a agendar, escríbeme "quiero una cita" 😊
>

- ✅ El bot respondió (además de la bienvenida)
- ✅ Cancela la cita
- ✅ Confirma al paciente
- ✅ Avisa a recepción
- ✅ Sin llamar a Gemini
- ✅ Sin precios inventados
- ✅ No promete bloquear el horario
- ✅ No finge ser humana
- ✅ Tono: mensajes cortos de WhatsApp
- ✅ Tono: tutea (no "usted")

### 9. Reprogramar ✅

> **Paciente**: Necesito cambiar mi cita, no voy a poder
>
> **Camila**: Claro 😊 Tu cita actual es el viernes, 2 de octubre a las 4:00 p. m. Elige el nuevo horario:  
>   
> 📅 Horarios disponibles:  
> 1️⃣ jueves, 1 de octubre a las 11:00 a. m.  
> 2️⃣ jueves, 1 de octubre a las 1:00 p. m.  
> 3️⃣ jueves, 1 de octubre a las 3:00 p. m.  
>   
> Responde 1, 2 o 3 👆
>
> **Paciente**: 1
>
> **🔔 Alerta a recepción**: 🔁 Cita reprogramada por el paciente — Clínica Dental Denvari  
> 👤 Lucía Paredes  
> 📱 +51000000109 (wa.me/51000000109)  
> 🩺 Limpieza dental (profilaxis)  
> 📅 jueves, 1 de octubre a las 11:00 a. m.
>
> **Camila**: ¡Listo! Tu solicitud de cambio quedó registrada para el jueves, 1 de octubre a las 11:00 a. m. en Calle Las Orquídeas 450, San Isidro, Lima (dirección de demostración). Recepción te la confirmará.
>

- ✅ El bot respondió (además de la bienvenida)
- ✅ Ofrece horarios nuevos
- ✅ Reprograma la cita
- ✅ Habla de solicitud que recepción confirma
- ✅ Avisa a recepción
- ✅ Sin precios inventados
- ✅ No promete bloquear el horario
- ✅ No finge ser humana
- ✅ Tono: mensajes cortos de WhatsApp
- ✅ Tono: tutea (no "usted")

### 10. "Quiero hablar con una persona" ✅

> **Paciente**: Quiero hablar con una persona por favor
>
> **Camila**: _[imagen logo.png]_ ¡Hola! 👋 Te damos la bienvenida a Clínica Dental Denvari 🦷✨  
>   
> Soy Camila, tu asistente virtual. Este mes tenemos campaña: evaluación digital 3D sin costo, cuota inicial S/ 0 y pago en cuotas.  
>   
> Cuéntame:  
> 👉 ¿Qué tratamiento o molestia dental quieres solucionar?  
> 👉 ¿O prefieres que te proponga de una vez horarios para tu evaluación? 📅  
>   
> 🔒 Aviso de privacidad (Ley 29733): guardamos tu nombre, número y los datos de tu cita solo para agendarte y recordarte tu atención. Puedes pedir que los eliminemos escribiendo "borrar mis datos".
>
> **Camila**: ¡Claro! Ya avisé a nuestro equipo; una persona te escribirá en unos minutos por este mismo chat. 📲
>
> **🔔 Alerta a recepción**: 🙋 Un paciente pide hablar con una persona (Clínica Dental Denvari)  
> 👤 Paciente de prueba · +51000000110 (wa.me/51000000110)  
> 💬 "Quiero hablar con una persona por favor"  
>   
> El bot quedó en pausa en esta conversación. Reactívalo desde el panel cuando termines.
>

- ✅ El bot respondió (además de la bienvenida)
- ✅ Responde que una persona le escribirá
- ✅ Pausa el bot
- ✅ Avisa a recepción
- ✅ Sin precios inventados
- ✅ No promete bloquear el horario
- ✅ No finge ser humana
- ✅ Tono: mensajes cortos de WhatsApp
- ✅ Tono: tutea (no "usted")

### 11. Dolor fuerte con hinchazón ✅

> **Paciente**: tengo un dolor fuerte en la muela y la cara hinchada, qué hago?
>
> **Camila**: Lamento que estés con esa molestia 🙏. Ya avisé a nuestro equipo clínico y te escribirán de inmediato por este chat. Por aquí no puedo darte diagnóstico ni indicarte medicamentos. Si el dolor, el sangrado o la hinchazón aumentan, acude a la clínica (Calle Las Orquídeas 450, San Isidro, Lima (dirección de demostración)) o a emergencias.  
>   
> 🔒 Aviso de privacidad (Ley 29733): guardamos tu nombre, número y los datos de tu cita solo para agendarte y recordarte tu atención. Puedes pedir que los eliminemos escribiendo "borrar mis datos".
>
> **🔔 Alerta a recepción**: 🚨 URGENCIA — responder de inmediato (Clínica Dental Denvari)  
> 👤 Paciente de prueba · +51000000111 (wa.me/51000000111)  
> 💬 "tengo un dolor fuerte en la muela y la cara hinchada, qué hago?"  
>   
> El bot quedó en pausa en esta conversación. Reactívalo desde el panel cuando termines.
>
> **Paciente**: hola? me pueden responder
>

- ✅ El bot respondió (además de la bienvenida)
- ✅ Deriva de inmediato sin diagnosticar ni recetar
- ✅ Pausa el bot (no contesta el 2.º mensaje)
- ✅ Alerta de URGENCIA a recepción
- ✅ Queda registrada en handoffs
- ✅ Sin precios inventados
- ✅ No promete bloquear el horario
- ✅ No finge ser humana
- ✅ Tono: mensajes cortos de WhatsApp
- ✅ Tono: tutea (no "usted")

### 15. Audio o sticker ✅

> **Paciente**: [audio]
>
> **Camila**: _[imagen logo.png]_ ¡Hola! 👋 Te damos la bienvenida a Clínica Dental Denvari 🦷✨  
>   
> Soy Camila, tu asistente virtual. Este mes tenemos campaña: evaluación digital 3D sin costo, cuota inicial S/ 0 y pago en cuotas.  
>   
> Cuéntame:  
> 👉 ¿Qué tratamiento o molestia dental quieres solucionar?  
> 👉 ¿O prefieres que te proponga de una vez horarios para tu evaluación? 📅  
>   
> 🌙 Ahora la clínica está cerrada, pero yo te ayudo ya mismo y te dejo la solicitud de cita lista; recepción te la confirma a primera hora.  
>   
> 🔒 Aviso de privacidad (Ley 29733): guardamos tu nombre, número y los datos de tu cita solo para agendarte y recordarte tu atención. Puedes pedir que los eliminemos escribiendo "borrar mis datos".
>
> **Camila**: Disculpa 🙏 todavía no puedo escuchar audios. ¿Me lo escribes en un mensaje? Así te ayudo al toque con precios, fotos u horarios.
>
> **Paciente**: [sticker]
>
> **Camila**: 😊 ¿En qué te ayudo? Puedo contarte precios, enviarte fotos de tratamientos o proponerte horarios para tu evaluación.
>

- ✅ El bot respondió (además de la bienvenida)
- ✅ Pide que escriba el audio
- ✅ Responde al sticker con opciones
- ✅ Sin llamar a Gemini
- ✅ Sin precios inventados
- ✅ No promete bloquear el horario
- ✅ No finge ser humana
- ✅ Tono: mensajes cortos de WhatsApp
- ✅ Tono: tutea (no "usted")

### 17. Gemini caído: respuesta de respaldo (10:30 p. m.) ✅

> **Paciente**: ¿Cuánto cuesta el blanqueamiento?
>
> **Camila**: _[imagen logo.png]_ ¡Hola! 👋 Te damos la bienvenida a Clínica Dental Denvari 🦷✨  
>   
> Soy Camila, tu asistente virtual. Este mes tenemos campaña: evaluación digital 3D sin costo, cuota inicial S/ 0 y pago en cuotas.  
>   
> Cuéntame:  
> 👉 ¿Qué tratamiento o molestia dental quieres solucionar?  
> 👉 ¿O prefieres que te proponga de una vez horarios para tu evaluación? 📅  
>   
> 🌙 Ahora la clínica está cerrada, pero yo te ayudo ya mismo y te dejo la solicitud de cita lista; recepción te la confirma a primera hora.  
>   
> 🔒 Aviso de privacidad (Ley 29733): guardamos tu nombre, número y los datos de tu cita solo para agendarte y recordarte tu atención. Puedes pedir que los eliminemos escribiendo "borrar mis datos".
>
> **Camila**: ¡Gracias por escribirnos! 😊 Te comparto los horarios más cercanos para tu evaluación:  
>   
> 📅 Horarios disponibles:  
> 1️⃣ viernes, 2 de octubre a las 9:00 a. m.  
> 2️⃣ viernes, 2 de octubre a las 11:00 a. m.  
> 3️⃣ viernes, 2 de octubre a las 1:00 p. m.  
>   
> Responde 1, 2 o 3 👆
>
> **🔔 Alerta a recepción**: ⚠️ El asistente no pudo responder con IA (Clínica Dental Denvari)  
> 📱 +51000000117 (wa.me/51000000117)  
> 💬 "¿Cuánto cuesta el blanqueamiento?"  
>   
> Escríbele al paciente. Si se repite, revisa GEMINI_API_KEY y la cuota de Gemini (npm run preflight).
>

- ✅ El bot respondió (además de la bienvenida)
- ✅ El paciente recibe horarios aunque la IA falle
- ✅ Recepción recibe la alerta de falla
- ✅ Sin precios inventados
- ✅ No promete bloquear el horario
- ✅ No finge ser humana
- ✅ Tono: mensajes cortos de WhatsApp
- ✅ Tono: tutea (no "usted")

