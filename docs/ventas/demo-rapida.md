# Demo en vivo en 15 minutos (desde tu celular, a mediodía, en modo nocturno)

Objetivo: que el doctor vea **en su propia mano** cómo responde la asistente a las 10:30 p. m., aunque sea mediodía.
El 🧪 **Probador** del panel usa el MISMO flujo que WhatsApp (debounce, Gemini, agenda, bandeja, alertas) con
WhatsApp simulado: no sale ningún mensaje a Meta y todo queda marcado como "prueba".

> **Antes de salir:** `GEMINI_API_KEY` tiene que estar en Render (opción 1) o en tu `.env` (opción 2). Sin la clave,
> la asistente contesta con el **respaldo** (horarios o "ya avisé al equipo"), que funciona pero no luce igual.
> Revísalo con `npm run preflight` (Gemini en ✅ y "2 de N modelos de respaldo responden").

## Opción 1 — Demo estándar desde el celular (producción, sin laptop)

1. **Abre el panel** en el navegador del celular: `https://asistente-dental.onrender.com/panel` y entra con la cuenta de
   **dueño** (`PANEL_OWNER_USER`). Ábrelo 2 minutos antes: si Render estaba dormido, tarda unos 30 s en despertar.
2. **Ve a 🧪 Probador** y toca **🌙 10:30 p. m.** en "Hora del bot". Toca **➕ Nueva conversación** para empezar limpio.
3. **Dale el celular al doctor** y pídele que escriba lo que le preguntaría un paciente de su anuncio, por ejemplo:
   *"vi su anuncio de brackets, ¿cuánto es la inicial?"*. En 3 a 6 segundos ve: bienvenida + aviso de privacidad +
   🌙 "la clínica está cerrada, pero yo te ayudo…" + precio "desde" + **3 horarios reales**.
4. **Que elija un horario** ("la 2") y dé su nombre: la respuesta dice *"solicitud de cita … Recepción te la
   confirmará"*. Muéstrale la pestaña **Agenda** (la solicitud aparece con la etiqueta prueba) y la **Bandeja**.
5. **Cierra con la seguridad:** toca el escenario **🚨 Dolor fuerte**: la asistente no diagnostica, deriva a una
   persona y pausa el bot. Al terminar toca **🗑️ Borrar pruebas** (borra solo lo marcado como prueba).

Escenarios de un toque si el doctor no sabe qué escribir: **🌙 Ráfaga nocturna** (3 mensajes seguidos → una sola
respuesta), **🦷 Dientes chuecos** (recomienda evaluación sin diagnosticar), **💸 "Está caro"**, **🤖 ¿Eres un robot?**
(dice que es una asistente virtual).

## Opción 2 — Demo personalizada con SU nombre, precios y campaña (sin tocar producción)

Se arma en tu laptop en **menos de 1 minuto** (el comando tarda ~2 s). **No cambia `ACTIVE_CLINIC` en Render** ni
escribe en Supabase: corre en memoria.

1. **Genera su clínica** con los datos de su anuncio (Biblioteca de anuncios de Meta), su web o su Google Maps:
   ```bash
   npm run quick-demo                       # pregunta los datos uno por uno
   npm run quick-demo -- prospecto.json     # o desde un archivo (ejemplo abajo)
   ```
   Crea `config/clinics/demo-<nombre>.js` (**falla si queda algún TODO o dato inválido**) y `media/demo-<nombre>/`
   con su logo (o un monograma con sus iniciales y colores si no lo tienes) y el catálogo ilustrado (ortodoncia y
   carillas, si los ofrece) **con sus colores, su nombre y sus precios "desde"**, marcado "Imagen referencial".
   Además deja en `tmp/cards-demo-<nombre>/` la tarjeta del pack, un pase de cita de ejemplo y la ficha del doctor:
   ábrelos y revísalos antes de grabar. Medios de pago y FAQ quedan vacíos a propósito: la asistente no inventa lo
   que no sabes (regla 14). Sin pack (qué incluye y precio) no hay tarjeta del pack.

   Ejemplo de `prospecto.json` (solo `name`, `address`, `hours`, `campaign` y `prices` son obligatorios):
   ```json
   {
     "name": "Clínica Dental Sonrisa Perfecta",
     "address": "Av. Principal 450, Consultorio 302, Miraflores",
     "hours": "lun-vie 09:00-13:00,14:00-20:00; sab 09:00-14:00",
     "campaign": "Evaluación con escaneo 3D y brackets con inicial S/ 0",
     "colors": { "primary": "#1d4ed8", "accent": "#22d3ee" },
     "logo": "C:/Users/tu-usuario/Downloads/logo-sonrisa.png",
     "prices": { "ortodoncia": 1500, "carillas": 250, "limpieza": 80 },
     "pack": { "title": "Pack Evaluación Digital 3D", "includes": "Radiografía panorámica, Escaneo intraoral 3D, Plan de tratamiento", "price": 50, "bring": "Solo trae tu DNI." },
     "promotion": { "text": "Gratis si inicias el mismo día", "validUntil": "2026-12-15", "packPrice": 0 },
     "specialist": "Dr. Alejandro Vega"
   }
   ```
   Tratamientos que acepta `prices`: ortodoncia, carillas, implantes, blanqueamiento, limpieza, odontopediatria,
   endodoncia, extraccion. Horario: días `lun mar mie jue vie sab dom`, rangos con coma para el refrigerio y
   `dom cerrado`. El logo solo puede ser JPG, PNG o WebP de hasta 2 MB (se revisa el archivo, no la extensión), y
   úsalo solo si la clínica te lo dio o está en su página pública para mostrarle su demo.
2. **Arranca la demo lista para grabar** (modo noche 10:30 p. m., confirmación directa con pase, alertas a números
   falsos):
   ```bash
   npm run demo:video -- demo-<nombre>
   ```
   La consola imprime el enlace (`/panel?video=1#tester`), el usuario `demo` y la contraseña de esa sesión. Para una
   demo sin grabar: `$env:ACTIVE_CLINIC="demo-<nombre>"; npm run demo`.
3. **Ábrela en tu celular:** conecta el celular al mismo Wi-Fi o al hotspot de tu laptop y abre
   `http://<IP-de-tu-laptop>:3000/panel` (la IP sale con `ipconfig` → "Dirección IPv4"). Si Windows pregunta por el
   firewall, permite Node.js en redes privadas. Entra como dueño (usuario `demo` y la contraseña que muestra la consola,
   o tu `PANEL_OWNER_USER`).
4. **Sigue los pasos 2 a 5 de la Opción 1.** El doctor ve su nombre, su logo, su campaña y sus precios.

Los archivos `config/clinics/demo-*.js` y `media/demo-*/` están en `.gitignore`: nunca se suben ni llegan a Render.
Para borrar una demo: elimina esos dos archivos/carpeta.

## Si algo falla en vivo

| Síntoma | Qué hacer |
|---|---|
| La respuesta tarda o dice "ya avisé al equipo" | Gemini saturado o sin clave: es el **respaldo**, y también es parte del producto ("nunca deja al paciente sin respuesta"). Sigue con los horarios. |
| El panel no carga en el celular (opción 2) | Mismo Wi-Fi/hotspot, IP correcta, puerto 3000 y permiso de firewall. Plan B: muestra la laptop. |
| El panel de producción tarda | Render despertando: espera 30 s y recarga. |
| Quieres repetir | **➕ Nueva conversación** (opción 1) o **🗑️ Borrar pruebas**. |
