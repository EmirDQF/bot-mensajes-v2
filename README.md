# Asistente de WhatsApp 24/7 para clínicas dentales (white-label)

Atiende el WhatsApp de una clínica dental a cualquier hora: responde precios y dudas, envía fotos, ofrece 3 horarios
libres reales y deja la **solicitud de cita** lista para que recepción la confirme. De noche avisa con naturalidad que
la clínica está cerrada, deriva urgencias a recepción, envía recordatorios y le manda al dueño un resumen diario y un
reporte semanal con la línea de la garantía.

Clínica demo: **Clínica Dental Denvari** (100 % ficticia), asistente **Camila**.

## Empezar

```bash
npm install
cp .env.example .env        # completa los valores (nunca subas .env)
npm run preflight           # dice qué falta y cómo arreglarlo, sin mostrar claves
npm start                   # http://localhost:3000/health · panel en /panel
npm run test:unit
```

## Documentación

| Para | Archivo |
|---|---|
| Programar (stack, mapa del código, reglas) | `CLAUDE.md` |
| Poner en producción (Render, Supabase, Meta, cron-job.org) | `docs/deploy.md` |
| Instalar una clínica nueva y medir la garantía | `docs/onboarding-cliente.md` |
| Plantillas de WhatsApp para aprobar en Meta | `docs/whatsapp-templates.md` |
| QA conversacional (`npm run simulate`) | `docs/qa-report.md` |
| Demo de 60 s y kit de venta | `docs/demo-script.md`, `docs/ventas/` |
