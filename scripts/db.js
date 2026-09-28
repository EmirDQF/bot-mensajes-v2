// npm run db:print   → imprime, en orden, los "PEGA N° X" del SQL que Supabase aún no tiene (para el SQL Editor).
// npm run db:migrate → con SUPABASE_DB_URL aplica directo las migraciones pendientes y las anota en
//                      schema_migrations. --dry-run por defecto; --apply para ejecutar.
// Todas las migraciones son idempotentes: volver a aplicar una no rompe nada. Nunca imprime la URL ni claves.
import { loadEnv, parseArgs, printResults, result, runIfMain, redact } from './lib/cli.js';
import { checkSupabase, parseMigrationSchema, pendingMigrationFiles, formatPasteBlocks, readMigrations } from './preflight.js';

export const SCHEMA_MIGRATIONS_SQL = `CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;`;

// Migraciones que faltan según schema_migrations (en orden de fecha).
export function planMigrations(files, applied) {
  const done = new Set(applied);
  return files.filter((f) => !done.has(f.name));
}

// client: cualquier objeto con query(sql, params) (pg.Client). Cada migración va en su propia transacción.
export async function applyMigrations(client, files, { apply = false } = {}) {
  // En dry-run no se crea nada: si schema_migrations aún no existe, todo figura como pendiente.
  if (apply) await client.query(SCHEMA_MIGRATIONS_SQL);
  const { rows: [table] } = await client.query("SELECT to_regclass('public.schema_migrations') AS name");
  const { rows } = table?.name ? await client.query('SELECT filename FROM public.schema_migrations') : { rows: [] };
  const pending = planMigrations(files, rows.map((r) => r.filename));
  if (!pending.length) return [result('ok', 'La base de datos ya tiene todas las migraciones')];
  const results = [];
  for (const file of pending) {
    if (!apply) {
      results.push(result('info', `Se aplicaría migrations/${file.name}`));
      continue;
    }
    try {
      await client.query('BEGIN');
      await client.query(file.sql);
      await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file.name]);
      await client.query('COMMIT');
      results.push(result('ok', `Aplicada migrations/${file.name}`));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      results.push(result('fail', `migrations/${file.name}: ${redact(error.message)}`, 'Corrige el error y vuelve a correr: las anteriores ya quedaron aplicadas.'));
      return results;
    }
  }
  if (apply) await client.query("NOTIFY pgrst, 'reload schema'");
  return results;
}

async function printCommand() {
  const { default: config } = await import('../config/env.js');
  const migrations = readMigrations();
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    console.log('Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para detectar qué falta. Mientras, pega TODAS las migraciones (son idempotentes):');
    console.log(formatPasteBlocks(migrations.map((m) => m.name)));
    return 0;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  const results = await checkSupabase(client, parseMigrationSchema(migrations));
  const pending = pendingMigrationFiles(results);
  const problems = results.filter((r) => r.status !== 'ok');
  if (problems.length) printResults(`Supabase (${migrations.length} migraciones)`, problems);
  if (!pending.length) {
    console.log(problems.length ? '\nNo hay SQL que pegar, pero revisa los ❌ de arriba.' : '\n✅ Supabase ya tiene todas las tablas y columnas. No hay nada que pegar.');
    return problems.some((r) => r.status === 'fail') ? 1 : 0;
  }
  console.log(formatPasteBlocks(pending));
  console.log('\nAl terminar, corre de nuevo npm run db:print: debe decir que no hay nada que pegar.');
  return 0;
}

async function migrateCommand(env, apply) {
  if (!env.SUPABASE_DB_URL) {
    console.log('Falta SUPABASE_DB_URL (Supabase → Connect → Connection string → URI, modo "Session pooler").');
    console.log('Sin ella usa npm run db:print y pega los bloques en el SQL Editor.');
    return 1;
  }
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch {
    console.log('Falta la dependencia de desarrollo pg: corre npm install (sin --omit=dev) y vuelve a intentarlo.');
    return 1;
  }
  const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log(`🗄️  Migraciones en Supabase${apply ? '' : ' — DRY RUN (agrega --apply para ejecutarlas)'}`);
    const results = await applyMigrations(client, readMigrations(), { apply });
    printResults('Resultado', results);
    return results.some((r) => r.status === 'fail') ? 1 : 0;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const env = await loadEnv();
  const { apply, positional } = parseArgs();
  const command = positional[0] || 'print';
  if (command === 'print') return printCommand();
  if (command === 'migrate') return migrateCommand(env, apply);
  console.error('Uso: node scripts/db.js print | migrate [--apply]');
  return 1;
}

runIfMain(import.meta.url, main);
