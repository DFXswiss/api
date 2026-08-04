/**
 * Regenerates docs/endpoints.md and docs/load-sites.md from the working tree.
 *
 *   npm run build && node scripts/inventory/run.js [output-dir]
 *
 * The column counts come from the TypeORM metadata, which only exist once the entities are
 * compiled — hence the build. No database is involved.
 *
 * The documents are written to the output directory, not over docs/. Two columns of endpoints.md
 * and the prose of both documents are maintained by hand; see README.md.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.inventory-out'));

const env = {
  ...process.env,
  API_SRC: path.join(ROOT, 'src'),
  GEN_SP: OUT,
  DIST: path.join(ROOT, 'dist'),
  // The entities import each other as `src/...`, which resolves through tsconfig's baseUrl at
  // compile time and through nothing at all at run time. NODE_PATH is what makes dist loadable.
  NODE_PATH: path.join(ROOT, 'dist'),
};

if (!fs.existsSync(env.API_SRC)) fail(`no source tree at ${env.API_SRC}`);
if (!fs.existsSync(path.join(env.DIST, 'src'))) fail(`no built tree at ${env.DIST}/src — run 'npm run build' first`);

const STAGES = [
  ['load sites', 'python3', ['extract-load-sites.py']],
  [
    'column counts from the entity metadata',
    'node',
    ['measure-columns.js', j('sites.json'), j('measured.json'), j('meta-tables.json')],
  ],
  [
    'join measurements onto the sites',
    'python3',
    ['join-measurements.py'],
    { IN_SITES: j('sites.json'), IN_MEASURED: j('measured.json'), OUT_MEASURED: j('sites-measured.json') },
  ],
  ['routes from the controllers', 'python3', ['extract-routes.py']],
  ['deprecation flags', 'python3', ['add-flags.py']],
  ['per-endpoint union over the reachable load sites', 'python3', ['resolve-endpoints.py']],
  ['render', 'python3', ['render-docs.py']],
  ['figures the prose claims', 'node', ['probe-claims.js']],
];

fs.mkdirSync(OUT, { recursive: true });

STAGES.forEach(([label, cmd, args, extra], i) => {
  console.log(`== ${i + 1}/${STAGES.length}  ${label}`);
  const script = path.join(HERE, args[0]);
  const r = spawnSync(cmd, [script, ...args.slice(1)], {
    cwd: ROOT,
    env: { ...env, ...(extra || {}) },
    stdio: 'inherit',
  });
  if (r.status !== 0) fail(`${args[0]} exited with ${r.status ?? r.signal}`);
});

console.log(`\nwritten to ${OUT}:`);
for (const f of fs
  .readdirSync(OUT)
  .filter((f) => f.endsWith('.md'))
  .sort())
  console.log(`  ${f}`);

function j(name) {
  return path.join(OUT, name);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
