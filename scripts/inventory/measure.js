/**
 * Misst je Ladestelle die echte SELECT-Spaltenzahl aus den TypeORM-Metadaten.
 *
 * Gegenüber der Vorgängerfassung ausserhalb dieses Repos in genau zwei Punkten geändert:
 *   - parametrisiert (DIST, INPUT, OUT_MEASURED, OUT_TABLES per Umgebung/argv) statt fest verdrahtet,
 *   - `buildMetadatas()` statt `initialize()`, also OHNE Datenbank.
 * Das Ausgabeformat ist unverändert, damit build_docs.py es unbesehen lesen.
 *
 * Der Stub-Bootstrap stammt aus proof.js und ist in reference_dfx_api_typeorm_metadata_messung
 * begründet: native Module fehlen auf diesem Worker, src/config/config erzwingt ~300 Env-Variablen,
 * und @arkade-os/sdk ist ESM. Keine der Entities liest die Config innerhalb eines Dekorators, die
 * Metadaten hängen also nicht daran.
 */
const Module = require('module');
const _load = Module._load;
const deep = () =>
  new Proxy(function () {}, {
    get: (t, p) => (p === 'then' ? undefined : deep()),
    apply: () => deep(),
    construct: () => deep(),
  });
const HARD = [/^@arkade-os\/sdk/, /^node-pty$/, /^@scure\/btc-signer/];
Module._load = function (request) {
  if (HARD.some((r) => r.test(request))) return deep();
  // tsc emits relative requires for the config ("../../../config/config"), so anchoring on src/ or
  // dist/ misses every one of them and the real config loads - which then dies on the first missing
  // env var. Match the trailing config/config instead, guarded so that e.g. "myconfig/config" stays
  // untouched.
  if (/(^|[./])config\/config(\.js)?$/.test(request)) return deep();
  try {
    return _load.apply(this, arguments);
  } catch (e) {
    if (String(e && e.code) === 'ERR_REQUIRE_ESM' || /native module|\.node'|prebuilds/.test(String(e && e.message))) {
      // Missing native modules must not fail the run, but the proxy substitution should stay visible.
      console.error(`[inventory] replacing module "${request}" with proxy stub: ${String((e && (e.message || e.code)) || e)}`);
      return deep();
    }
    throw e;
  }
};

require('reflect-metadata');
const fs = require('fs');
const { DataSource } = require('typeorm');

const DIST = process.env.DIST;
const INPUT = process.argv[2];
const OUT_MEASURED = process.argv[3];
const OUT_TABLES = process.argv[4];
if (!DIST || !INPUT || !OUT_MEASURED || !OUT_TABLES) {
  console.error('Aufruf: DIST=<dist> node measure.js <sites.json> <measured.json> <meta-tables.json>');
  process.exit(2);
}

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    entities: [DIST + '/src/**/*.entity.js'],
    synchronize: false,
    migrationsRun: false,
    logging: false,
  });

  // Kein initialize(): die Metadaten genügen, und eine Verbindung würde nur eine Fehlerquelle
  // hinzufügen, die mit der Messung nichts zu tun hat.
  await ds.buildMetadatas();
  console.log(JSON.stringify({ step: 'init', entities: ds.entityMetadatas.length }));

  const perTable = {};
  for (const m of ds.entityMetadatas) {
    perTable[m.tableName] = perTable[m.tableName] || { cols: m.columns.length, entities: [] };
    perTable[m.tableName].entities.push(m.name);
    perTable[m.tableName].cols = Math.max(perTable[m.tableName].cols, m.columns.length);
  }
  fs.writeFileSync(OUT_TABLES, JSON.stringify(perTable, null, 1));

  const sites = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const out = [];
  for (const s of sites) {
    const meta = ds.entityMetadatas.find((m) => m.name === s.entity);
    if (!meta) {
      out.push({ ...s, error: 'entity not found' });
      continue;
    }
    try {
      const qb = ds.createQueryBuilder(meta.target, 'root');
      qb.setFindOptions({ relations: s.relations });
      const sql = qb.getQuery();
      const sel = sql.slice(sql.indexOf('SELECT') + 6, sql.indexOf(' FROM '));
      const cols = sel.split(',').filter((x) => x.trim()).length;
      const joins = (sql.match(/\bJOIN\b/g) || []).length;
      // Key is `cols`, not `columns`: endpoint_eff.py and build_docs.py both read `cols`, and an
      // earlier variant of this script emitted the wider name - which left every measurement
      // silently unmatched and every column count at zero.
      out.push({ ...s, cols, joins, over: cols > 1664 });
    } catch (e) {
      out.push({ ...s, error: String(e.message).slice(0, 120) });
    }
  }
  fs.writeFileSync(OUT_MEASURED, JSON.stringify(out, null, 1));
  const ok = out.filter((o) => o.cols !== undefined);
  const tables = Object.keys(perTable).length;
  const columns = Object.values(perTable).reduce((a, t) => a + t.cols, 0);
  console.log(JSON.stringify({ step: 'done', measured: ok.length, failed: out.length - ok.length, tables, columns }));
}

main().catch((e) => {
  console.error('FEHLER:', e.stack || e.message);
  process.exit(1);
});
