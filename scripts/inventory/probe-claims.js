/**
 * Measures the four figures read-path-projections.md states outside its tables: the size of the
 * schema, the eager declarations, the two worked query examples, and the number of getters.
 * Same stubbed module loader as measure-columns.js, and no database.
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
const { DataSource } = require('typeorm');
const DIST = process.env.DIST;

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    entities: [DIST + '/src/**/*.entity.js'],
    synchronize: false,
    logging: false,
  });
  await ds.buildMetadatas();

  const tables = {};
  for (const m of ds.entityMetadatas) tables[m.tableName] = Math.max(tables[m.tableName] || 0, m.columns.length);
  const eager = ds.entityMetadatas.reduce((a, m) => a + m.eagerRelations.length, 0);
  const eagerEntities = ds.entityMetadatas.filter((m) => m.eagerRelations.length).length;

  const shape = (name) => {
    const m = ds.entityMetadatas.find((x) => x.name === name);
    if (!m) return null;
    // setFindOptions({}) is the find path: only there does TypeORM expand the eager relations.
    const qb = ds.createQueryBuilder(m.target, 'root');
    qb.setFindOptions({});
    const sql = qb.getQuery();
    const sel = sql.slice(sql.indexOf('SELECT') + 6, sql.indexOf(' FROM '));
    return { cols: sel.split(',').filter((x) => x.trim()).length, joins: (sql.match(/\bJOIN\b/g) || []).length };
  };

  // A getter with field access: a property without a column that exists on the prototype as one.
  let getters = 0,
    getterEntities = 0;
  for (const m of ds.entityMetadatas) {
    const proto = m.target && m.target.prototype;
    if (!proto) continue;
    const cols = new Set(m.columns.map((c) => c.propertyName));
    const names = Object.getOwnPropertyNames(proto).filter((n) => {
      const d = Object.getOwnPropertyDescriptor(proto, n);
      return d && typeof d.get === 'function' && !cols.has(n);
    });
    if (names.length) {
      getters += names.length;
      getterEntities++;
    }
  }

  console.log(
    JSON.stringify(
      {
        entities: ds.entityMetadatas.length,
        tables: Object.keys(tables).length,
        columns: Object.values(tables).reduce((a, b) => a + b, 0),
        eager,
        eagerEntities,
        userData: shape('UserData'),
        limitRequest: shape('LimitRequest'),
        getters,
        getterEntities,
      },
      null,
      1,
    ),
  );
}
main().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});
