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

Se arma en tu laptop en ~5 minutos. **No cambia `ACTIVE_CLINIC` en Render** ni escribe en Supabase: corre en memoria.

1. **Genera su clínica** con los datos de su anuncio (Biblioteca de anuncios de Meta):
   ```bash
   npm run quick-demo
   ```
   Pregunta nombre, dirección ("Distrito, Lima" basta), la campaña del anuncio en una línea y los precios "desde"
   (Enter = no lo ofrece). Crea `config/clinics/demo-<nombre>.js` y **falla si queda algún TODO o dato inválido**.
   Medios de pago, FAQ y promociones quedan vacíos a propósito: la asistente no inventa lo que no sabes (regla 14).
2. **Ilustraciones con su nombre** (el comando exacto lo imprime el paso 1):
   ```powershell
   pwsh scripts/generate-demo-media.ps1 -ClinicId demo-<nombre> -ClinicName "<Nombre>" -ShortName "<CORTO>" -AddressLine "<dirección>" -AddressNote "" -Footnote "Imagen referencial"
   ```
3. **Arranca la demo con esa clínica:**
   ```powershell
   $env:ACTIVE_CLINIC="demo-<nombre>"; npm run demo
   ```
   (Git Bash: `ACTIVE_CLINIC=demo-<nombre> npm run demo`). La consola dice "Clínica activa: <Nombre>".
4. **Ábrela en tu celular:** conecta el celular al mismo Wi-Fi o al hotspot de tu laptop y abre
   `http://<IP-de-tu-laptop>:3000/panel` (la IP sale con `ipconfig` → "Dirección IPv4"). Si Windows pregunta por el
   firewall, permite Node.js en redes privadas. Entra como dueño (usuario `demo` y la contraseña que muestra la consola,
   o tu `PANEL_OWNER_USER`).
5. **Sigue los pasos 2 a 5 de la Opción 1.** El doctor ve su nombre, su logo, su campaña y sus precios.

Los archivos `config/clinics/demo-*.js` y `media/demo-*/` están en `.gitignore`: nunca se suben ni llegan a Render.
Para borrar una demo: elimina esos dos archivos/carpeta.

## Si algo falla en vivo

| Síntoma | Qué hacer |
|---|---|
| La respuesta tarda o dice "ya avisé al equipo" | Gemini saturado o sin clave: es el **respaldo**, y también es parte del producto ("nunca deja al paciente sin respuesta"). Sigue con los horarios. |
| El panel no carga en el celular (opción 2) | Mismo Wi-Fi/hotspot, IP correcta, puerto 3000 y permiso de firewall. Plan B: muestra la laptop. |
| El panel de producción tarda | Render despertando: espera 30 s y recarga. |
| Quieres repetir | **➕ Nueva conversación** (opción 1) o **🗑️ Borrar pruebas**. |
