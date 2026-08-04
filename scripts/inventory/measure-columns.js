/**
 * Measures, per load site, the real SELECT column count from the TypeORM metadata.
 *
 * Parameterised through DIST and three positional arguments:
 *
 *   DIST=<built tree> node measure-columns.js <sites.json> <measured.json> <meta-tables.json>
 *
 * No database is involved. `buildMetadatas()` is enough, and a connection would only add a
 * failure source that has nothing to do with the measurement.
 *
 * The module loader below is stubbed because the entities cannot otherwise be required outside
 * the application: native modules may be absent, `src/config/config` demands around three hundred
 * environment variables, and one dependency is ESM. No entity reads the config inside a decorator,
 * so the metadata do not depend on any of it.
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
  if (/(^|\/)src\/config\/config$|dist\/src\/config\/config(\.js)?$/.test(request)) return deep();
  try {
    return _load.apply(this, arguments);
  } catch (e) {
    if (String(e && e.code) === 'ERR_REQUIRE_ESM' || /native module|\.node'|prebuilds/.test(String(e && e.message)))
      return deep();
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
  console.error('usage: DIST=<dist> node measure-columns.js <sites.json> <measured.json> <meta-tables.json>');
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

  // No initialize(): the metadata are what this needs, and no entity reads the config inside a
  // decorator, so the metadata do not depend on it.
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
      // setFindOptions is the find path, and only there does TypeORM expand the eager relations.
      // A query builder does not apply them — measuring one through setFindOptions reports the
      // eager closure instead of the root entity and overstates the site several times over.
      if (s.kind === 'find') qb.setFindOptions({ relations: s.relations });
      const sql = qb.getQuery();
      const sel = sql.slice(sql.indexOf('SELECT') + 6, sql.indexOf(' FROM '));
      const cols = sel.split(',').filter((x) => x.trim()).length;
      const joins = (sql.match(/\bJOIN\b/g) || []).length;
      out.push({ ...s, columns: cols, joins, over: cols > 1664 });
    } catch (e) {
      out.push({ ...s, error: String(e.message).slice(0, 120) });
    }
  }
  fs.writeFileSync(OUT_MEASURED, JSON.stringify(out, null, 1));
  // A site whose entity resolved but whose relation tree does not: the document shows it as a
  // dash, which is what it is — but the count belongs in the log, so a new one is not silent.
  const unresolved = out.filter((o) => o.error && o.entity && o.error !== 'entity not found');
  if (unresolved.length) {
    console.error(`not measurable although the entity resolved: ${unresolved.length}`);
    for (const u of unresolved) console.error(`  ${u.file}:${u.line}  ${u.entity}  ${u.error}`);
  }

  const ok = out.filter((o) => o.columns);
  const tables = Object.keys(perTable).length;
  const columns = Object.values(perTable).reduce((a, t) => a + t.cols, 0);
  console.log(JSON.stringify({ step: 'done', measured: ok.length, failed: out.length - ok.length, tables, columns }));
}

main().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});
