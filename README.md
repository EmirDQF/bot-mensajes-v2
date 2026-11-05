# Asistente de WhatsApp 24/7 para clínicas dentales (white-label)

Atiende el WhatsApp de una clínica dental a cualquier hora, como una recepcionista:

- **Responde al instante, también de noche**, con los precios "desde", la campaña y las preguntas frecuentes de la
  clínica. Entiende cómo escriben los pacientes ("frenillos", "bravkets", "cuanto sale", "precio pls").
- **Catálogo visual:** envía las imágenes del tratamiento por el que preguntan (sin repetirlas) y la **tarjeta del pack
  de evaluación** (qué incluye, precio y promoción vigente, todo sacado de la configuración).
- **Horarios libres reales en botones** (hasta 3, o una lista): el paciente agenda con un toque. Si no ve botones,
  responde "1" o "jueves 4:30".
- **Dos modos de agendamiento:** *solicitud* (por defecto: recepción confirma) o *confirmación directa* (el bot reserva
  el horario de forma atómica en la agenda del panel y envía un **pase de cita** en imagen con un QR que solo lleva el
  código de la cita).
- **Recordatorios** configurables (por defecto 48 h y 2 h antes) con botones *Confirmo* / *Reprogramar*.
- **Ficha para recepción y el doctor** con nombre, interés, cita, estado del recordatorio y enlace a la conversación.
- **Urgencias a una persona:** ante dolor fuerte, sangrado, hinchazón, fiebre o golpe no diagnostica, pausa el bot y avisa.
- **Seguimiento ético** cuando el paciente no responde (3 h, ~22 h y día 3 solo con permiso), máximo 3; se detiene
  si dice "no", agenda, pasa a humano o es menor de edad.
- **Promociones a pacientes anteriores** (pestaña Campañas) solo con permiso de promociones guardado, máximo una cada 14 días.
- **Audios** transcritos con Gemini (opcional, solo con el plan pagado de Gemini); el audio no se guarda.
- **Panel**: bandeja en vivo, agenda, métricas medidas (primera respuesta, % sin intervención humana, solicitudes,
  confirmadas, asistencias), reporte semanal, **Mi clínica** (toda la configuración sin tocar código), Campañas y Probador.

Clínica demo: **Clínica Dental Denvari** (100 % ficticia), asistente **Camila**, especialista ficticia.

## Empezar

```bash
npm install
cp .env.example .env        # completa los valores (nunca subas .env)
npm run preflight           # dice qué falta y cómo arreglarlo, sin mostrar claves
npm start                   # http://localhost:3000/health · panel en /panel
npm run test:unit
npm run demo                # panel con pacientes inventados (Supabase en memoria, WhatsApp simulado)
npm run simulate            # conversaciones reales contra Gemini (necesita GEMINI_API_KEY) → docs/qa-report.md
```

## Documentación

| Para | Archivo |
|---|---|
| Programar (stack, mapa del código, reglas) | `CLAUDE.md` |
| Poner en producción (Render, Supabase, Meta, cron-job.org) | `docs/deploy.md`, `docs/go-live.md` |
| Instalar una clínica nueva y medir la garantía | `docs/onboarding-cliente.md` |
| Plantillas de WhatsApp para aprobar en Meta | `docs/whatsapp-templates.md` |
| Textos legales y de consentimiento (para el abogado) | `config/legalTexts.js` |
| QA conversacional (`npm run simulate`) | `docs/qa-report.md` |
| Guion del video de demo y kit de venta | `docs/demo-script.md`, `docs/ventas/` |
| Mejoras pendientes (severidad media) | `docs/mejoras-pendientes.md` |
