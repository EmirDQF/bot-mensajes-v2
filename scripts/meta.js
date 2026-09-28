// npm run meta:check | meta:subscribe | meta:templates — WhatsApp Cloud API por API, sin clics.
// subscribe y templates son --dry-run por defecto: nada cambia en Meta hasta pasar --apply.
// Nunca imprime el token (solo los últimos 4 caracteres de los ids públicos).
import { loadEnv, parseArgs, printResults, runIfMain } from './lib/cli.js';
import { checkTokenType, checkPhoneNumber, checkWaba, subscribeApp, submitTemplates, isExpiredResult } from './lib/meta.js';

async function main() {
  const env = await loadEnv();
  const { apply, positional } = parseArgs();
  const command = positional[0] || 'check';
  const { TEMPLATES } = await import('../config/whatsappTemplates.js');
  const mode = apply ? '' : ' — DRY RUN (agrega --apply para ejecutarlo)';
  let sections;
  let footer = '';

  if (command === 'check') {
    console.log('🔎 Meta: estado de tu WhatsApp Business (sin secretos)');
    const token = await checkTokenType(env);
    // Con el token vencido todo lo demás falla igual: se muestran los pasos una sola vez.
    sections = isExpiredResult(token) ? [['Token', token]] : [
      ['Token', token],
      ['Número', await checkPhoneNumber(env)],
      ['Cuenta de WhatsApp Business (WABA)', await checkWaba(env, TEMPLATES)],
    ];
  } else if (command === 'subscribe') {
    console.log(`🔗 Suscribir la app al WABA${mode}`);
    sections = [['Suscripción', await subscribeApp(env, { apply })]];
    footer = '\nRecuerda: la URL del webhook y el campo "messages" se configuran UNA vez en developers.facebook.com → tu app → WhatsApp → Configuración (docs/go-live.md, paso 5).';
  } else if (command === 'templates') {
    const { default: clinic } = await import('../config/clinic.config.js');
    console.log(`📝 Plantillas a aprobación en Meta (idioma "es")${mode}`);
    sections = [['Plantillas', await submitTemplates(env, TEMPLATES, clinic, { apply })]];
    footer = '\nMeta revisa cada plantilla en minutos u horas. Revisa el estado con npm run meta:check.';
  } else {
    console.error('Uso: node scripts/meta.js check | subscribe [--apply] | templates [--apply]');
    return 1;
  }

  for (const [title, results] of sections) printResults(title, results);
  if (footer) console.log(footer);
  return sections.flatMap(([, r]) => r).some((r) => r.status === 'fail') ? 1 : 0;
}

runIfMain(import.meta.url, main);
