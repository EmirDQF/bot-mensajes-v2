# Plan de 7 días para cerrar el primer cliente

Meta: **1 clínica firmada y conectada** al día 7. Todo con datos **medidos por ti** (regla 14): tu prueba nocturna,
tus capturas y, después de conectar, el reporte del sistema. Lleva el avance en `prospectos.csv` (una fila por clínica).

| Día | Qué haces | Tiempo | Resultado del día | Guía |
|---|---|---|---|---|
| **1** | Prospección en Meta Ad Library: clínicas de Lima con anuncios **activos** de brackets, implantes o diseño de sonrisa que llevan a WhatsApp. Anota 15 en `prospectos.csv` (estado `nuevo`). **Noche (10–11 p. m.):** a 10 de ellas les escribes como paciente la pregunta de su anuncio ("¿cuánto es la inicial de brackets?"). | 30 min + 20 min | 15 filas, 10 con `hora_prueba` | `prospeccion.md`, `prueba-nocturna.md` |
| **2** | 9:00 a. m.: anota quién respondió, cuándo y cómo (`respondio`, `minutos_respuesta`, `captura`). Busca al director/a de las que no respondieron o tardaron. Graba la **demo personalizada (B)** de las 3 mejores (su nombre, logo y precios). | 2 h | 3 demos grabadas; estado `prueba_hecha` | `../demo-script.md` |
| **3** | Envía el mensaje con **su captura** + la demo de 90 s a esas 3. Repite la prueba nocturna con 5 prospectos nuevos. | 1 h + 15 min | 3 en `contactado` | `mensajes-contacto.md`, `loom-auditoria.md` |
| **4** | Responde objeciones y agenda una llamada o visita de 15 min. Seguimiento a los del día 3 que no contestaron (un solo mensaje). Envía 3 mensajes más (día 2 del segundo grupo). | 1 h | ≥ 1 en `reunion` | `objeciones.md` |
| **5** | Reunión: muestra la demo en vivo (versión A si ya tienes el número de prueba desplegado; si no, B). Propuesta con la garantía: S/ 400 al conectar + S/ 400 si en 7 días hay 2 citas de evaluación confirmadas **con su pauta activa**. | 30 min por reunión | `propuesta_enviada` | `propuesta.md` |
| **6** | Firma del acuerdo y cobro de los primeros S/ 400. Pide logo, precios "desde", horario, FAQ y acceso a su Meta Business (verificación del negocio, tarjeta para las plantillas). | 1 h | `firmado` | `acuerdo-servicio.md`, `../onboarding-cliente.md` |
| **7** | Instalación: `npm run new-clinic`, completar datos, go-live y prueba en vivo con el director desde su celular. Empieza a correr la semana de la garantía. | 3–4 h | `conectado` | `../go-live.md` |

**Semana de la garantía (días 0–6 desde la conexión):** revisa la Bandeja cada mañana y pide a recepción que marque
las solicitudes en la Agenda. El día 7 imprime el **Reporte** (pestaña Reporte → Imprimir / PDF) y envíaselo al
director: si muestra 2 citas de evaluación confirmadas, cobras los S/ 400 restantes; si no, devuelves los S/ 400.

## Reglas para todo el plan

- **Nada inventado:** ni "las clínicas pierden X %", ni testimonios, ni capturas de otra clínica. Lo único que citas es
  lo que mediste en **su** chat (hora de tu mensaje y cuánto tardaron) y, después, el reporte del sistema.
- **La garantía exige pauta activa en Meta los 7 días**, que recepción marque las solicitudes en el panel y no apagar el
  asistente sin aviso (`acuerdo-servicio.md`, cláusula 4).
- **Las plantillas de WhatsApp las paga la clínica** en su cuenta de Meta (recordatorios fuera de la ventana de 24 h,
  resumen, reporte). Dilo en la reunión: es un costo aparte, lo cobra Meta, no tú.
- Un solo seguimiento por prospecto. Si dice que no, estado `descartado` con el motivo en `notas`.

## Columnas y estados de `prospectos.csv`

Ábrelo en Google Sheets (Archivo → Importar). `hora_prueba` como `dd/mm hh:mm`; `respondio` = `Sí`, `No` o
`Autorespuesta`; `minutos_respuesta` solo si hubo respuesta real; `captura` = nombre del archivo o link de tu captura.

`estado`: `nuevo` → `prueba_hecha` → `contactado` → `reunion` → `propuesta_enviada` → `firmado` → `conectado`
(o `descartado` en cualquier punto).
