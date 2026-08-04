/**
 * Measures the real SELECT column count per load site from the TypeORM metadata.
 *
 * Changed against the earlier version outside this repository in exactly two points:
 *   - parameterised (DIST, INPUT, OUT_MEASURED, OUT_TABLES via environment/argv) instead of hard-wired,
 *   - `buildMetadatas()` instead of `initialize()`, so WITHOUT a database.
 * The output format is unchanged, so build_docs.py reads it as is.
 *
 * The stub bootstrap is needed because three things get in the way of merely loading the entity
 * modules: native modules are missing depending on the host, src/config/config demands ~300
 * environment variables on import, and @arkade-os/sdk is ESM. None of the entities reads the
 * config inside a decorator, so the metadata does not depend on it.
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
  console.error('usage: DIST=<dist> node measure.js <sites.json> <measured.json> <meta-tables.json>');
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

  // No initialize(): the metadata is enough, and a connection would only add a failure mode
  // that has nothing to do with the measurement.
  await ds.buildMetadatas();
  console.log(JSON.stringify({ step: 'init', entities: ds.entityMetadatas.length }));
  // Without entities every site below reports "entity not found" and the run still ends with
  // exit 0 - the whole chain then completes and publishes a document whose every column count
  // is zero. Silent-zero is the failure mode this pipeline has already produced once; it fails
  // loudly here instead.
  if (ds.entityMetadatas.length === 0) {
    console.error(`FATAL: no entities found under ${DIST}/src - is dist/ current? run \`npm run build\``);
    process.exit(1);
  }

  const perTable = {};
  for (const m of ds.entityMetadatas) {
    perTable[m.tableName] = perTable[m.tableName] || { cols: m.columns.length, entities: [] };
    perTable[m.tableName].entities.push(m.name);
    perTable[m.tableName].cols = Math.max(perTable[m.tableName].cols, m.columns.length);
  }
  fs.writeFileSync(OUT_TABLES, JSON.stringify(perTable, null, 1));

  const sites = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

  // A site that narrows its columns must be measured at what it selects, not at the default
  // query. Building the query without the projection reports the width the read path was
  // converted away from - the widest offender measured 364 columns where it selects 12, and
  // the document then read "497 columns to 364".
  const projectionCache = new Map();
  function projectionWidth(site) {
    const key = `${site.file}#${site.projection}`;
    if (!projectionCache.has(key)) {
      let width = null;
      try {
        const mod = require(`${DIST}/${site.file.replace(/\.ts$/, '.js')}`);
        const p = mod[site.projection];
        // fields feed the response, guards are selected too - both reach the SELECT list.
        if (p && Array.isArray(p.fields)) width = p.fields.length + (p.guards || []).length;
      } catch (e) {
        console.error(`[inventory] cannot resolve ${site.projection} in ${site.file}: ${e.message}`);
      }
      projectionCache.set(key, width);
    }
    return projectionCache.get(key);
  }

  const out = [];
  for (const s of sites) {
    // getCount()/getExists() discard the select list - no row is materialised, so a column
    // count would be a number about a query that never returns one.
    if (s.unmeasurable) {
      out.push({ ...s, error: 'no row materialised' });
      continue;
    }
    if (s.projection) {
      const width = projectionWidth(s);
      if (width === null) {
        // Falling through to the default-query measurement here would reproduce exactly the
        // bug this branch exists to fix: a projected site reported at the full entity width.
        // An unresolvable projection is a missing measurement, not a wide one.
        out.push({ ...s, error: `cannot resolve projection ${s.projection}` });
        continue;
      }
      // The projection joins with `leftJoin`, not `leftJoinAndSelect`: no relation is loaded
      // whole, so nothing widens the row beyond the field list.
      out.push({ ...s, cols: width, joins: 0, over: false });
      continue;
    }
    if (s.select_count) {
      out.push({ ...s, cols: s.select_count, joins: 0, over: false });
      continue;
    }
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
  // A run that measured nothing is not a run with zero-width queries - it is a broken run.
  // Sites without a resolvable entity are expected and counted as `failed`; none at all
  // measuring means the metadata never reached the sites.
  if (ok.length === 0) {
    console.error(`FATAL: 0 of ${out.length} sites measurable - the measurement produced nothing usable`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
