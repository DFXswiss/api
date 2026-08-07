#!/usr/bin/env node
/**
 * Handbook assembly for DFXswiss/api.
 *
 * Auto-discovers PDFs, mail previews, markdown docs, diagrams, runtime
 * assets and AsyncAPI specs; generates a deterministic index.html +
 * manifest.json. No hand-maintained mapping table: new artifacts appear
 * automatically. Floor guards catch empty/corrupt checkouts; exact
 * counts are never enforced.
 *
 * Usage:
 *   npm install --prefix ./_handbook-deps --no-save --no-audit --no-fund handlebars marked@15.0.7
 *   NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/build.js <output-dir>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// --- Floor guards (today's counts; never exact upper bounds) ---
const MIN_PDFS = 11;
const MIN_MAILS = 24;
const MIN_DOCS = 17;
const MIN_ASSETS = 10;
const MIN_FILE_BYTES = 1000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from('%PDF');
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const DEPS_INSTALL =
  'npm install --prefix ./_handbook-deps --no-save --no-audit --no-fund handlebars marked@15.0.7';

const MD_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'archive',
  'dist',
  'coverage',
  'coverage-gate',
  '_handbook-deps',
  'docs/handbook/build',
  'thunder-tests',
  'rest-client',
]);

const SORT_LOCALE = 'en';

function sortStrings(a, b) {
  return a.localeCompare(b, SORT_LOCALE);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadMarked() {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    return require('marked');
  } catch (err) {
    fail(
      'handbook: marked is required but could not be loaded.\n' +
        'Install it in isolation (do not add to package.json):\n' +
        '  ' +
        DEPS_INSTALL +
        '\n' +
        'Then re-run:\n' +
        '  NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/build.js <out>\n' +
        'Original error: ' +
        (err && err.message ? err.message : String(err)),
    );
  }
}

function assertHandlebarsResolvable() {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    require.resolve('handlebars');
  } catch (err) {
    fail(
      'handbook: handlebars is required but could not be loaded.\n' +
        'Install it in isolation (do not add to package.json):\n' +
        '  ' +
        DEPS_INSTALL +
        '\n' +
        'Then re-run:\n' +
        '  NODE_PATH=./_handbook-deps/node_modules node scripts/handbook/build.js <out>\n' +
        'Original error: ' +
        (err && err.message ? err.message : String(err)),
    );
  }
}

const markedModule = loadMarked();
const MarkedRenderer =
  typeof markedModule.Renderer === 'function'
    ? markedModule.Renderer
    : markedModule.marked && typeof markedModule.marked.Renderer === 'function'
      ? markedModule.marked.Renderer
      : null;
const markedParseImpl =
  typeof markedModule.parse === 'function'
    ? (md, opts) => markedModule.parse(md, opts)
    : typeof markedModule.marked?.parse === 'function'
      ? (md, opts) => markedModule.marked.parse(md, opts)
      : null;
if (!markedParseImpl) {
  fail('handbook: marked loaded but no parse() API found (expected marked@15).');
}
if (!MarkedRenderer) {
  fail('handbook: marked loaded but no Renderer class found (expected marked@15).');
}

// GitHub-compatible heading slug: lowercase; strip chars that are not letters
// (\p{L}), digits (\p{N}), marks (\p{M}), underscore (\p{Pc}), hyphen or space;
// spaces → '-'. No collapsing of multiple hyphens, no trim of leading/trailing
// hyphens. Unicode letters/digits/marks/underscore are kept. Duplicate slugs
// within one document get -1, -2, … (first occurrence keeps the bare slug).
// Counter is per parse call only.
function createHeadingRenderer() {
  const renderer = new MarkedRenderer();
  const seen = new Map();
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens, this.parser.textRenderer);
    let slug = String(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '')
      .replace(/ /g, '-');
    if (!slug) slug = 'section';
    if (seen.has(slug)) {
      const n = seen.get(slug);
      seen.set(slug, n + 1);
      slug = slug + '-' + n;
    } else {
      seen.set(slug, 1);
    }
    return (
      '<h' +
      depth +
      ' id="' +
      slug +
      '">' +
      this.parser.parseInline(tokens) +
      '</h' +
      depth +
      '>\n'
    );
  };
  return renderer;
}

// Renderer is created per call so heading-id counters never leak across documents.
function markedParse(md) {
  return markedParseImpl(md, { renderer: createHeadingRenderer() });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// URL-encode a relative output path for safe use inside an href/src attribute.
// encodeURIComponent (applied per path segment, so '/' stays a separator) is used
// instead of encodeURI, because encodeURI leaves the reserved characters '#' and '?'
// untouched — a filename containing either would otherwise silently produce a broken
// link (the browser truncates the URL at '#' / treats '?' as a query string start).
// Applied BEFORE escapeHtml — encodeURIComponent still leaves '&' untouched, so
// escapeHtml is still needed as a separate step to make the attribute value HTML-safe.
function encodeHtmlPath(p) {
  return String(p).split('/').map(encodeURIComponent).join('/');
}

// Inverse of encodeHtmlPath: decodeURIComponent per path segment (mirrors the
// encoder). Whole-string decodeURIComponent is equivalent for most paths, but
// segment-wise matches the encoder and keeps behaviour consistent if a segment
// is malformed (only that segment is left as-is).
function decodeHtmlPath(p) {
  return String(p)
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join('/');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function slugify(key) {
  return (
    String(key)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  );
}

function titleFromFilename(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

function firstMarkdownHeading(md) {
  const m = String(md).match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function readMagic(filePath, len) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(len);
  try {
    fs.readSync(fd, buf, 0, len, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

function assertMinSize(filePath) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (err) {
    fail(`handbook guard: cannot stat ${filePath}: ${err.message}`);
  }
  if (st.size <= MIN_FILE_BYTES) {
    fail(
      `handbook guard: ${filePath} is ${st.size} bytes (must be > ${MIN_FILE_BYTES}). ` +
        'Possible incomplete checkout or LFS pointer.',
    );
  }
  return st.size;
}

function assertValidPdf(filePath) {
  assertMinSize(filePath);
  const buf = readMagic(filePath, 4);
  if (!buf.equals(PDF_MAGIC)) {
    fail(
      `handbook PDF guard: ${filePath} does not start with %PDF magic bytes. ` +
        'Possible incomplete checkout.',
    );
  }
}

function assertValidPng(filePath) {
  assertMinSize(filePath);
  const buf = readMagic(filePath, 8);
  if (!buf.equals(PNG_MAGIC)) {
    fail(
      `handbook PNG guard: ${filePath} does not start with PNG magic bytes. ` +
        'Possible incomplete checkout or LFS pointer.',
    );
  }
}

function assertValidJpeg(filePath) {
  assertMinSize(filePath);
  const buf = readMagic(filePath, 3);
  if (!buf.equals(JPEG_MAGIC)) {
    fail(
      `handbook JPEG guard: ${filePath} does not start with JPEG magic bytes. ` +
        'Possible incomplete checkout.',
    );
  }
}

function listFilesWithExt(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(ext))
    .map((d) => d.name)
    .sort(sortStrings);
}

/**
 * Recursive directory walk. Returns relative paths (posix) from rootDir,
 * sorted. Skips excluded directory basenames and full relative prefixes.
 * Dot-directories are skipped except .github (legit docs live there).
 */
function isExcludedDir(name, rel, extraExcludeDirs) {
  if (name.startsWith('.') && name !== '.github') return true;
  if (MD_EXCLUDE_DIRS.has(name) || MD_EXCLUDE_DIRS.has(rel)) return true;
  if (extraExcludeDirs && (extraExcludeDirs.has(name) || extraExcludeDirs.has(rel))) return true;
  return false;
}

function walkFiles(rootDir, predicate, extraExcludeDirs) {
  const results = [];
  function walk(absDir, relDir) {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => sortStrings(a.name, b.name));
    for (const ent of entries) {
      const rel = relDir ? path.posix.join(relDir, ent.name) : ent.name;
      if (ent.isDirectory()) {
        if (isExcludedDir(ent.name, rel, extraExcludeDirs)) continue;
        walk(path.join(absDir, ent.name), rel);
      } else if (ent.isFile() && predicate(ent.name, rel)) {
        results.push(rel);
      }
    }
  }
  walk(rootDir, '');
  results.sort(sortStrings);
  return results;
}

// Inverse of escapeHtml. The &amp; rule MUST come last: undoing it first would
// turn an escaped "&lt;" (written as "&amp;lt;") into "&lt;" and then into "<",
// double-unescaping text that was never a tag. Escaping runs &amp; first, so
// unescaping runs it last.
function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&');
}

// Matches any absolute URI scheme (http:, https:, mailto:, data:,
// javascript:, vbscript:, file:, tel:, custom-scheme:, ...) per RFC 3986
// scheme syntax. Generic on purpose (see Befund 8 / CodeQL "Incomplete URL
// scheme check"): enumerating known-bad prefixes is inherently incomplete,
// whereas this recognizes "is this an absolute URI at all" and skips it.
const ABSOLUTE_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function collectRelativeRefs(html) {
  const refs = [];
  // Only match real attribute names (after start-of-string, whitespace, or '<').
  // A word boundary alone also matches after '-' / ':', so data-src, xlink:href,
  // ng-src etc. would be treated as resources even though they are not browser-resolved.
  // Alternation per quote style so a double-quoted value may contain apostrophes
  // (e.g. href="docs/Bank's%20Guide.md" from marked link parsing).
  const re = /(?:^|[\s<])(?:src|href)=(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1] !== undefined ? m[1] : m[2];
    if (ABSOLUTE_SCHEME_RE.test(raw) || raw.startsWith('//') || raw.startsWith('#')) {
      continue;
    }
    let cleaned = raw.split('#')[0].split('?')[0];
    if (!cleaned) continue;
    cleaned = decodeHtmlPath(decodeHtmlEntities(cleaned));
    refs.push(cleaned);
  }
  return refs;
}

// Resolve a cleaned relative ref from a markdown source path to a repo-root-relative
// candidate (posix). Leading '/' is repo-root-relative. Shared by rewrite + integrity.
function resolveDocRefCandidate(cleanedRef, sourcePath) {
  const baseDir = path.posix.dirname(sourcePath);
  // A leading '/' is repo-root-relative (common in Markdown). path.posix.join
  // would otherwise append it under baseDir (e.g. docs/ + /package.json → docs/package.json).
  return cleanedRef.startsWith('/')
    ? path.posix.normalize(cleanedRef.slice(1))
    : path.posix.normalize(path.posix.join(baseDir, cleanedRef));
}

// Rewrite href/src in rendered doc body so links to handbook artifacts
// (other docs, assets, diagrams, …) point at their output paths relative to
// this page. Fragment/query suffixes are preserved. Absolute URIs,
// protocol-relative, and pure anchors are left untouched. bodyHtml for
// integrity stays unre-written.
function rewriteDocBodyRefs(bodyHtml, sourcePath, outputPath, sourceToOutput) {
  // Alternation per quote style (same rule as collectRelativeRefs). Prefix is
  // its own group so the replace callback can rewrite only the attribute value.
  const re = /((?:^|[\s<])(?:src|href)=)(?:"([^"]*)"|'([^']*)')/g;
  return bodyHtml.replace(re, (match, prefix, doubleQ, singleQ) => {
    const raw = doubleQ !== undefined ? doubleQ : singleQ;
    if (ABSOLUTE_SCHEME_RE.test(raw) || raw.startsWith('//') || raw.startsWith('#')) {
      return match;
    }
    let suffixStart = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '?' || raw[i] === '#') {
        suffixStart = i;
        break;
      }
    }
    const cleanedRaw = suffixStart >= 0 ? raw.slice(0, suffixStart) : raw;
    const suffix = suffixStart >= 0 ? raw.slice(suffixStart) : '';
    if (!cleanedRaw) return match;

    const cleaned = decodeHtmlPath(decodeHtmlEntities(cleanedRaw));

    const candidate = resolveDocRefCandidate(cleaned, sourcePath);
    // Escapes are hard failures in the integrity check, not rewritten here.
    if (candidate === '..' || candidate.startsWith('../')) return match;
    if (!sourceToOutput.has(candidate)) return match;

    const targetOut = sourceToOutput.get(candidate);
    const rel = path.posix.relative(path.posix.dirname(outputPath), targetOut);
    // Always emit double quotes; value is percent-encoded so this is valid HTML.
    return prefix + '"' + encodeHtmlPath(rel) + suffix + '"';
  });
}

function checkDocPageReferences(doc, repoRoot, sourceToOutput) {
  const refs = collectRelativeRefs(doc.bodyHtml);
  for (const ref of refs) {
    const candidate = resolveDocRefCandidate(ref, doc.sourcePath);
    // path.posix.normalize does not strip a leading ".." — clamp escapes so a
    // link like /../outside never checks (or warns about) a path outside the repo.
    if (candidate === '..' || candidate.startsWith('../')) {
      fail(
        `handbook integrity check failed (${doc.sourcePath}): reference escapes the repo root: ${ref} (resolved: ${candidate})`,
      );
    }
    if (sourceToOutput.has(candidate)) continue; // known handbook artifact (incl. other docs)
    if (fs.existsSync(path.join(repoRoot, candidate))) {
      console.error(
        `handbook warning: ${doc.sourcePath} references repo file "${ref}" ` +
          `(resolved: ${candidate}) that exists but is not part of the handbook output.`,
      );
      continue;
    }
    fail(
      `handbook integrity check failed (${doc.sourcePath}): referenced path does not exist anywhere in the repo: ${ref} (resolved: ${candidate})`,
    );
  }
}

function metaLookup(metadata, key) {
  const m = metadata[key];
  if (!m) return { titel: null, beschreibung: null };
  return {
    titel: m.titel || m.title || null,
    beschreibung: m.beschreibung || m.description || null,
  };
}

function docOutputPath(sourceRel) {
  // Keep source path recognizable: docs/foo.md -> docs/docs-foo.html etc.
  // Prefer nested dirs under docs/ that mirror the source relative path.
  const noExt = sourceRel.replace(/\.md$/i, '');
  const parts = noExt.split('/');
  if (parts.length === 1) {
    return path.posix.join('docs', parts[0] + '.html');
  }
  // e.g. docs/endpoints -> docs/docs/endpoints.html
  //      skills/db-debug/SKILL -> docs/skills/db-debug/SKILL.html
  return path.posix.join('docs', ...parts) + '.html';
}

function sourceDirGroup(sourceRel) {
  const dir = path.posix.dirname(sourceRel);
  if (dir === '.' || dir === '') return '(Repo-Root)';
  return dir + '/';
}

function wrapTablesInScrollContainer(html) {
  // Wrap every <table>…</table> in a scrollable container so wide tables
  // (e.g. docs/endpoints.md) never force the page itself to scroll sideways.
  return html.replace(
    /<table[\s\S]*?<\/table>/gi,
    (table) => `<div class="table-scroll">${table}</div>`,
  );
}

const MD_PAGE_STYLE =
  'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
  'max-width:960px;margin:32px auto;padding:0 20px;line-height:1.55;color:#e8eaed;background:#1a1d23;}' +
  'a{color:#7eb8da;}code{font-family:SF Mono,Menlo,Consolas,monospace;font-size:0.9em;' +
  'background:#252a33;padding:1px 5px;border-radius:3px;}' +
  'pre{overflow:auto;background:#252a33;padding:12px;border-radius:6px;}' +
  'img{max-width:100%;height:auto;}' +
  'h1,h2,h3{color:#f0f2f5;}' +
  '.table-scroll{overflow-x:auto;max-width:100%;margin:1em 0;}' +
  'table{border-collapse:collapse;font-size:13px;}' +
  'th,td{border:1px solid #3a4250;padding:6px 10px;text-align:left;}' +
  'th{background:#252a33;}';

function main() {
  const outArg = process.argv[2];
  if (!outArg) {
    fail('Usage: node scripts/handbook/build.js <output-dir>');
  }

  assertHandlebarsResolvable();

  const scriptDir = __dirname;
  const repoRoot = process.env.HANDBOOK_REPO_ROOT
    ? path.resolve(process.env.HANDBOOK_REPO_ROOT)
    : path.resolve(scriptDir, '../..');
  const outDir = path.resolve(outArg);
  const gitSha = process.env.GIT_SHA || process.env.HANDBOOK_GIT_SHA || 'unknown';

  // NODE_PATH for child mail generator (and our own requires).
  const nodePathExtra = path.join(repoRoot, '_handbook-deps', 'node_modules');
  const childNodePath = [nodePathExtra, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);

  const metadataPath = path.join(scriptDir, 'metadata.json');
  let metadata = {};
  if (fs.existsSync(metadataPath)) {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }

  // Clean output dir for deterministic re-runs (only the target tree).
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  ensureDir(outDir);

  const artifacts = [];

  // =========================================================================
  // Source B first: mail previews (must run BEFORE discovery of mails/)
  // =========================================================================
  const mailGenScript = path.join(repoRoot, 'scripts/generate-realunit-previews.js');
  if (!fs.existsSync(mailGenScript)) {
    fail(`handbook: missing mail preview generator ${mailGenScript}`);
  }
  const mailProc = spawnSync('node', [mailGenScript], {
    cwd: repoRoot,
    env: { ...process.env, NODE_PATH: childNodePath },
    encoding: 'utf8',
  });
  if (mailProc.error) {
    fail('handbook: mail preview generator failed to start:\n' + mailProc.error.message);
  }
  if (mailProc.status !== 0) {
    fail(
      'handbook: mail preview generator failed (exit ' + mailProc.status + '):\n' +
        (mailProc.stdout || '') + (mailProc.stderr || ''),
    );
  }
  const mailStdout = mailProc.stdout || '';
  const mailStderr = mailProc.stderr || '';
  const TRIGGER_MISSING_RE = /^\[trigger\] Missing.*$/gm;
  const missingTriggers = [
    ...(mailStdout.match(TRIGGER_MISSING_RE) || []),
    ...(mailStderr.match(TRIGGER_MISSING_RE) || []),
  ];
  if (missingTriggers.length) {
    fail(
      'handbook: mail preview generator reported missing trigger explanations:\n' +
        missingTriggers.map((l) => '  ' + l).join('\n'),
    );
  }

  const mailSrcDir = path.join(repoRoot, 'scripts/email-previews/realunit');
  if (!fs.existsSync(mailSrcDir)) {
    fail(`handbook: mail preview output missing after generator run: ${mailSrcDir}`);
  }
  const mailFiles = listFilesWithExt(mailSrcDir, '.html').filter((name) => name !== '00_index.html');
  const mailEntries = [];
  for (const name of mailFiles) {
    const src = path.join(mailSrcDir, name);
    const relOut = path.posix.join('mails', name);
    copyFile(src, path.join(outDir, relOut));
    const title = titleFromFilename(name);
    mailEntries.push({ name, outputPath: relOut, title });
    artifacts.push({
      category: 'mails',
      outputPath: relOut,
      sourcePath: path.posix.join('scripts/email-previews/realunit', name),
      title,
    });
  }
  // Duplicate 00_index.html as index.html for directory listing entry.
  // Register as artifact only when the source exists so the manifest check
  // covers the copy; the index link is emitted under the same condition.
  const index00 = path.join(mailSrcDir, '00_index.html');
  let hasMailIndex = false;
  if (fs.existsSync(index00)) {
    copyFile(index00, path.join(outDir, 'mails', 'index.html'));
    hasMailIndex = true;
    artifacts.push({
      category: 'mails',
      outputPath: 'mails/index.html',
      sourcePath: path.posix.join('scripts/email-previews/realunit', '00_index.html'),
      title: 'mails/index.html',
      // Navigation page only — not a real mail; excluded from counts.mails.
      navigation: true,
    });
  }
  if (mailEntries.length < MIN_MAILS) {
    fail(
      `handbook floor guard: found ${mailEntries.length} mail HTML files, ` +
        `need at least MIN_MAILS=${MIN_MAILS}. ` +
        'Check scripts/generate-realunit-previews.js and templates.',
    );
  }

  // =========================================================================
  // Source A: recursive PDF discovery (docs, integration references, …)
  // =========================================================================
  const PDF_REGEN_HINTS = {
    'docs/examples/realunit-receipt': 'GENERATE_RECEIPT_EXAMPLES=true npx jest realunit-receipt-example',
    'docs/examples/realunit-statement': 'GENERATE_STATEMENT_EXAMPLE=true npx jest realunit-statement-example',
  };
  const PDF_EXTRA_EXCLUDE_DIRS = new Set([
    // Tiny synthetic KYC upload fixtures for scripts/kyc/upload-kyc-files.*,
    // not documentation — and smaller than MIN_FILE_BYTES, which would trip
    // the "incomplete checkout" guard as a false positive.
    'scripts/kyc/dummy-files',
  ]);
  const pdfRels = walkFiles(
    repoRoot,
    (name) => name.toLowerCase().endsWith('.pdf'),
    PDF_EXTRA_EXCLUDE_DIRS,
  );
  const pdfDirs = Array.from(new Set(pdfRels.map((rel) => path.posix.dirname(rel)))).sort(
    sortStrings,
  );
  const pdfGroups = pdfDirs.map((dir) => ({
    key: dir,
    dir,
    regen: PDF_REGEN_HINTS[dir] || null,
  }));
  const pdfEntries = [];
  for (const g of pdfGroups) {
    const names = pdfRels
      .filter((rel) => path.posix.dirname(rel) === g.dir)
      .map((rel) => path.posix.basename(rel))
      .sort(sortStrings);
    for (const name of names) {
      const src = path.join(repoRoot, g.dir, name);
      assertValidPdf(src);
      const relOut = path.posix.join('pdfs', g.key, name);
      copyFile(src, path.join(outDir, relOut));
      const title = titleFromFilename(name);
      pdfEntries.push({ group: g.key, name, outputPath: relOut, title, regen: g.regen });
      artifacts.push({
        category: 'pdfs',
        outputPath: relOut,
        sourcePath: path.posix.join(g.dir, name),
        title,
      });
    }
  }
  if (pdfEntries.length < MIN_PDFS) {
    fail(
      `handbook floor guard: found ${pdfEntries.length} PDFs, ` +
        `need at least MIN_PDFS=${MIN_PDFS}. ` +
        'Check recursive *.pdf discovery and excluded fixture dirs.',
    );
  }

  // =========================================================================
  // Source C: recursive markdown discovery
  // =========================================================================
  const mdRels = walkFiles(repoRoot, (name) => name.toLowerCase().endsWith('.md'));
  // Filter out anything under excluded path prefixes (also docs/handbook itself
  // except we already exclude docs/handbook/build; exclude generated README of
  // handbook output and the handbook docs folder content is fine to include).
  const mdFiltered = mdRels.filter((rel) => {
    const parts = rel.split('/');
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.slice(0, i + 1).join('/');
      if (isExcludedDir(parts[i], prefix)) {
        return false;
      }
    }
    return true;
  });

  // Render docs but defer rewrite + disk write until the full sourceToOutput
  // map exists (after Source F). Integrity uses unre-written bodyHtml; the
  // emitted page rewrites refs against every handbook artifact (docs, assets, …).
  const docEntries = [];
  for (const rel of mdFiltered) {
    const src = path.join(repoRoot, rel);
    const md = fs.readFileSync(src, 'utf8');
    const meta = metaLookup(metadata, rel);
    const heading = firstMarkdownHeading(md);
    const title = meta.titel || heading || titleFromFilename(path.basename(rel));
    const outRel = docOutputPath(rel);
    let body = markedParse(md);
    if (typeof body !== 'string') body = String(body);
    body = wrapTablesInScrollContainer(body);
    docEntries.push({
      sourcePath: rel,
      outputPath: outRel,
      title,
      beschreibung: meta.beschreibung,
      group: sourceDirGroup(rel),
      bodyHtml: body,
    });
    artifacts.push({
      category: 'docs',
      outputPath: outRel,
      sourcePath: rel,
      title,
    });
  }
  if (docEntries.length < MIN_DOCS) {
    fail(
      `handbook floor guard: found ${docEntries.length} markdown docs, ` +
        `need at least MIN_DOCS=${MIN_DOCS}. Check recursive *.md discovery.`,
    );
  }

  // =========================================================================
  // Source D: architecture diagram
  // =========================================================================
  const diagramEntries = [];
  const dexJpgRel = 'src/subdomains/supporting/dex/docs/DEX_Module.jpg';
  const dexDrawioRel = 'src/subdomains/supporting/dex/docs/DEX_Module.drawio';
  const dexJpgSrc = path.join(repoRoot, dexJpgRel);
  const dexDrawioSrc = path.join(repoRoot, dexDrawioRel);
  if (fs.existsSync(dexJpgSrc)) {
    assertValidJpeg(dexJpgSrc);
    const outJpg = path.posix.join('diagrams', 'DEX_Module.jpg');
    copyFile(dexJpgSrc, path.join(outDir, outJpg));
    diagramEntries.push({
      kind: 'image',
      outputPath: outJpg,
      sourcePath: dexJpgRel,
      title: 'DEX Module',
    });
    artifacts.push({
      category: 'diagrams',
      outputPath: outJpg,
      sourcePath: dexJpgRel,
      title: 'DEX Module',
    });
  } else {
    fail(`handbook: missing diagram ${dexJpgRel}`);
  }
  if (fs.existsSync(dexDrawioSrc)) {
    const outDraw = path.posix.join('diagrams', 'DEX_Module.drawio');
    copyFile(dexDrawioSrc, path.join(outDir, outDraw));
    diagramEntries.push({
      kind: 'download',
      outputPath: outDraw,
      sourcePath: dexDrawioRel,
      title: 'DEX_Module.drawio',
    });
    artifacts.push({
      category: 'diagrams',
      outputPath: outDraw,
      sourcePath: dexDrawioRel,
      title: 'DEX_Module.drawio',
    });
  }

  // =========================================================================
  // Source E: runtime assets (assets/*.png)
  // =========================================================================
  const assetsDir = path.join(repoRoot, 'assets');
  const assetNames = listFilesWithExt(assetsDir, '.png');
  const assetEntries = [];
  for (const name of assetNames) {
    const src = path.join(assetsDir, name);
    assertValidPng(src);
    const relOut = path.posix.join('assets', name);
    copyFile(src, path.join(outDir, relOut));
    const title = titleFromFilename(name);
    assetEntries.push({ name, outputPath: relOut, title });
    artifacts.push({
      category: 'assets',
      outputPath: relOut,
      sourcePath: path.posix.join('assets', name),
      title,
    });
  }
  if (assetEntries.length < MIN_ASSETS) {
    fail(
      `handbook floor guard: found ${assetEntries.length} PNG assets, ` +
        `need at least MIN_ASSETS=${MIN_ASSETS}. Check assets/*.png.`,
    );
  }

  // =========================================================================
  // Source F: AsyncAPI / specs
  // =========================================================================
  const specEntries = [];
  const asyncapiRel = 'src/integration/exchange/docs/scrypt-asyncapi.yaml';
  const asyncapiSrc = path.join(repoRoot, asyncapiRel);
  if (fs.existsSync(asyncapiSrc)) {
    const outYaml = path.posix.join('specs', 'scrypt-asyncapi.yaml');
    copyFile(asyncapiSrc, path.join(outDir, outYaml));
    specEntries.push({
      kind: 'download',
      outputPath: outYaml,
      sourcePath: asyncapiRel,
      title: 'scrypt-asyncapi.yaml',
    });
    artifacts.push({
      category: 'specs',
      outputPath: outYaml,
      sourcePath: asyncapiRel,
      title: 'scrypt-asyncapi.yaml',
    });
  } else {
    fail(`handbook: missing AsyncAPI spec ${asyncapiRel}`);
  }
  // Companion README is also under docs discovery — link to rendered page.
  const exchangeReadmeRel = 'src/integration/exchange/docs/README.md';
  const exchangeDoc = docEntries.find((d) => d.sourcePath === exchangeReadmeRel);
  if (exchangeDoc) {
    specEntries.push({
      kind: 'doc',
      outputPath: exchangeDoc.outputPath,
      sourcePath: exchangeReadmeRel,
      title: exchangeDoc.title,
    });
  }

  // Map from repo-relative source path -> output-relative path, built from
  // every artifact this build has produced (PDFs, mails, docs, diagrams,
  // assets, specs). Used for doc href rewrites and integrity checks.
  const sourceToOutput = new Map();
  for (const a of artifacts) {
    sourceToOutput.set(a.sourcePath, a.outputPath);
  }

  // Write doc pages now that sourceToOutput covers all handbook artifacts
  // (not only .md sources), so e.g. PNG links rewrite to assets/… correctly.
  for (const entry of docEntries) {
    const bodyForPage = rewriteDocBodyRefs(
      entry.bodyHtml,
      entry.sourcePath,
      entry.outputPath,
      sourceToOutput,
    );
    const page =
      '<!DOCTYPE html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      `<title>${escapeHtml(entry.title)} — DFX API Handbook</title>\n` +
      `<style>${MD_PAGE_STYLE}</style>\n</head>\n<body>\n` +
      bodyForPage +
      '\n</body>\n</html>\n';
    const dest = path.join(outDir, entry.outputPath);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, page, 'utf8');
  }

  // =========================================================================
  // Orphan metadata warnings (keys without matching artifact / group)
  // =========================================================================
  const knownMetaKeys = new Set([
    'pdfs',
    'mails',
    'docs',
    'diagrams',
    'assets',
    'specs',
    'docs/examples/realunit-receipt',
    'docs/examples/realunit-statement',
    'src/integration/exchange/docs',
    ...docEntries.map((d) => d.sourcePath),
    ...pdfEntries.map((p) => p.group),
  ]);
  for (const key of Object.keys(metadata).sort(sortStrings)) {
    if (!knownMetaKeys.has(key)) {
      console.error(
        `handbook warning: metadata.json entry "${key}" has no matching artifact (orphan).`,
      );
    }
  }

  // =========================================================================
  // HTML page
  // =========================================================================
  const css = `
      :root {
        /* Dark, neutral backend-handbook palette (no external brand assets). */
        --bg: #12151a;
        --surface: #1c2129;
        --surface-2: #252a33;
        --line: #343b48;
        --line-2: #454e5e;
        --ink: #e8eaed;
        --ink-2: #c4c9d1;
        --ink-3: #8b93a1;
        --ink-4: #6b7382;
        --brand: #5b9fd4;
        --brand-soft: rgba(91, 159, 212, 0.12);
        --warn: #d4a24c;
        --content-width: 960px;
      }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-size: 14.5px;
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
        overflow-x: hidden;
      }
      a { color: var(--brand); text-decoration: none; }
      a:hover { text-decoration: underline; }
      code {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 0.88em;
        background: var(--surface-2);
        padding: 1.5px 5px;
        border-radius: 3px;
        border: 1px solid var(--line);
        color: var(--ink);
      }
      .wrap {
        display: grid;
        grid-template-columns: 240px 1fr;
        gap: 32px;
        max-width: 1280px;
        margin: 0 auto;
        padding: 32px;
      }
      @media (max-width: 900px) {
        .wrap { grid-template-columns: 1fr; }
        aside { position: static !important; height: auto !important; }
      }
      aside {
        position: sticky;
        top: 32px;
        align-self: start;
        height: calc(100vh - 64px);
        overflow-y: auto;
        padding-right: 12px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 15px;
        color: var(--ink);
        margin-bottom: 4px;
      }
      .brand .dot {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--brand);
      }
      .brand-sub {
        font-size: 12.5px;
        color: var(--ink-3);
        margin: 0 0 20px 0;
      }
      .toc-label {
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-4);
        margin: 18px 0 8px;
      }
      .toc ol { list-style: none; padding: 0; margin: 0; }
      .toc li { margin: 2px 0; }
      .toc a {
        display: block;
        padding: 4px 6px;
        border-radius: 3px;
        font-size: 13px;
        color: var(--ink-2);
      }
      .toc a:hover {
        background: var(--surface-2);
        text-decoration: none;
        color: var(--ink);
      }
      .toc .spec-num {
        display: inline-block;
        min-width: 22px;
        font-variant-numeric: tabular-nums;
        color: var(--ink-4);
        font-size: 11.5px;
        margin-right: 8px;
      }
      main { max-width: var(--content-width); min-width: 0; }
      .hero h1 {
        margin: 0 0 14px 0;
        font-size: 28px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .lede {
        font-size: 15.5px;
        color: var(--ink-2);
        margin: 0 0 18px 0;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 18px;
        font-size: 13px;
        color: var(--ink-3);
      }
      .meta b { color: var(--ink); font-weight: 600; }
      hr.sep {
        border: 0;
        border-top: 1px solid var(--line);
        margin: 48px 0;
      }
      details.spec {
        margin: 0 0 56px;
        scroll-margin-top: 24px;
      }
      details.spec > summary {
        list-style: none;
        cursor: pointer;
        user-select: none;
        padding: 6px 0 4px;
      }
      details.spec > summary::-webkit-details-marker { display: none; }
      details.spec > summary:focus-visible {
        outline: 2px solid var(--brand);
        outline-offset: 4px;
        border-radius: 4px;
      }
      details.spec > summary:hover .spec-head .lhs h2 { color: var(--brand); }
      .spec-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 24px;
        margin-bottom: 14px;
      }
      .spec-head .lhs h2 {
        margin: 0 0 4px 0;
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.005em;
        display: inline-flex;
        align-items: baseline;
        gap: 10px;
        transition: color 0.15s;
      }
      .spec-head .lhs h2::before {
        content: '▸';
        display: inline-block;
        width: 12px;
        font-size: 14px;
        color: var(--ink-4);
        transition: transform 0.18s ease-out, color 0.15s;
        transform: translateY(-1px);
      }
      details.spec[open] .spec-head .lhs h2::before {
        transform: translateY(-1px) rotate(90deg);
        color: var(--brand);
      }
      .spec-head .lhs h2 .num {
        display: inline-block;
        min-width: 38px;
        color: var(--ink-4);
        font-variant-numeric: tabular-nums;
        font-weight: 500;
      }
      .spec-head .file {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12.5px;
        color: var(--ink-3);
      }
      .spec-head .rhs {
        text-align: right;
        font-size: 12.5px;
        color: var(--ink-3);
      }
      .spec-head .rhs b { color: var(--ink); font-weight: 600; }
      .spec-intro {
        color: var(--ink-2);
        margin: 14px 0 24px;
      }
      .tests {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      }
      .test {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
        scroll-margin-top: 20px;
      }
      .test:target {
        outline: 2px solid var(--brand);
        outline-offset: -1px;
      }
      .test .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--line);
        background: var(--surface-2);
      }
      .test .name {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px;
        font-weight: 600;
        color: var(--ink);
        word-break: break-all;
      }
      .test .body {
        padding: 12px 14px;
        font-size: 13px;
        color: var(--ink-2);
      }
      .test .img {
        background: var(--surface-2);
        display: flex;
        justify-content: center;
        padding: 14px;
      }
      .test .img img {
        max-width: 100%;
        height: auto;
        border-radius: 6px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
      }
      .callout {
        border-left: 3px solid var(--brand);
        background: var(--brand-soft);
        padding: 14px 18px;
        margin: 24px 0;
        border-radius: 0 4px 4px 0;
      }
      .callout.info {
        border-color: var(--ink-3);
        background: var(--surface-2);
      }
      .callout.warn {
        border-color: var(--warn);
        background: rgba(212, 162, 76, 0.10);
      }
      .callout p {
        margin: 0;
        color: var(--ink-2);
        font-size: 13.5px;
      }
      .callout b { color: var(--ink); }
      .toc-actions { margin: 6px 0 16px; }
      .toc-actions button {
        appearance: none;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 4px;
        color: var(--ink-2);
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        padding: 5px 10px;
        margin-right: 6px;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
      }
      .toc-actions button:hover {
        background: var(--surface-2);
        border-color: var(--line-2);
        color: var(--ink);
      }
      .asset-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 16px;
      }
      .asset-card {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 16px;
        text-align: center;
      }
      .asset-card img {
        max-width: 100%;
        max-height: 120px;
        height: auto;
      }
      .asset-card .an {
        margin-top: 10px;
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 11.5px;
        color: var(--ink-2);
        word-break: break-all;
      }
      .subgroup {
        margin: 28px 0 12px;
        font-size: 16px;
        font-weight: 600;
        color: var(--ink);
      }
      .subgroup-path {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--ink-3);
        font-weight: 400;
        margin-left: 8px;
      }
      .regen {
        font-size: 12.5px;
        color: var(--ink-3);
        margin: 0 0 14px;
      }
      .link-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .link-list li {
        margin: 6px 0;
        padding: 8px 12px;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 6px;
      }
      .link-list .src {
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 11.5px;
        color: var(--ink-4);
        margin-left: 8px;
      }
      .diagram-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 20px;
        align-items: start;
      }
      @media (max-width: 700px) {
        .diagram-row { grid-template-columns: 1fr; }
      }
      .diagram-row img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        border: 1px solid var(--line);
      }
  `;

  const script = `
    (function () {
      function openTargetFromHash() {
        var hash = location.hash ? location.hash.slice(1) : '';
        if (!hash) return;
        // IDs may start with a digit — use getElementById, not querySelector('#'+…).
        var el = document.getElementById(hash);
        if (!el) return;
        var details = el.closest ? el.closest('details.spec') : null;
        if (!details && el.tagName === 'DETAILS') details = el;
        if (details) details.open = true;
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'start' });
        }
      }
      document.addEventListener('DOMContentLoaded', openTargetFromHash);
      window.addEventListener('hashchange', openTargetFromHash);

      document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute) return;
        if (t.id === 'toc-expand-all') {
          document.querySelectorAll('details.spec').forEach(function (d) { d.open = true; });
        }
        if (t.id === 'toc-collapse-all') {
          document.querySelectorAll('details.spec').forEach(function (d) { d.open = false; });
        }
      });
    })();
  `;

  let tocItems = [];
  let sectionsHtml = '';
  let sectionNum = 0;

  function pushSection(id, title, fileHint, countLabel, intro, bodyHtml) {
    sectionNum += 1;
    const n = String(sectionNum).padStart(2, '0');
    tocItems.push({ id, n, title });
    sectionsHtml += `
      <details class="spec" id="${escapeHtml(id)}" open>
        <summary>
          <div class="spec-head">
            <div class="lhs">
              <h2><span class="num">${escapeHtml(n)}</span>${escapeHtml(title)}</h2>
              ${fileHint ? `<div class="file">${escapeHtml(fileHint)}</div>` : ''}
            </div>
            <div class="rhs">${countLabel ? `<b>${escapeHtml(countLabel)}</b>` : ''}</div>
          </div>
        </summary>
        ${intro ? `<p class="spec-intro">${intro}</p>` : ''}
        ${bodyHtml}
      </details>`;
  }

  // --- PDFs ---
  {
    const catMeta = metaLookup(metadata, 'pdfs');
    let body = '';
    for (const g of pdfGroups) {
      const groupMeta = metaLookup(metadata, g.key);
      const items = pdfEntries.filter((p) => p.group === g.key);
      if (!items.length) continue;
      body += `<h3 class="subgroup">${escapeHtml(groupMeta.titel || g.key)}` +
        `<span class="subgroup-path">${escapeHtml(g.dir)}</span></h3>`;
      if (groupMeta.beschreibung) {
        body += `<p class="spec-intro">${escapeHtml(groupMeta.beschreibung)}</p>`;
      }
      if (g.regen) {
        body += `<p class="regen">Regenerieren: <code>${escapeHtml(g.regen)}</code></p>`;
      }
      body += '<ul class="link-list">';
      for (const p of items) {
        body +=
          `<li><a href="${escapeHtml(encodeHtmlPath(p.outputPath))}">${escapeHtml(p.name)}</a>` +
          `<span class="src">${escapeHtml(p.outputPath)}</span></li>`;
      }
      body += '</ul>';
    }
    pushSection(
      'pdfs',
      catMeta.titel || 'Beispielbelege',
      'docs/examples/realunit-*',
      `${pdfEntries.length} PDFs`,
      catMeta.beschreibung
        ? escapeHtml(catMeta.beschreibung)
        : 'Committete PDF-Beispiele. Im Browser inline lesbar (Content-Disposition: inline).',
      body,
    );
  }

  // --- Mails ---
  {
    const catMeta = metaLookup(metadata, 'mails');
    let cards = '<div class="tests">';
    for (const m of mailEntries) {
      const cardId = 'mail-' + slugify(m.name);
      cards +=
        `<div class="test" id="${escapeHtml(cardId)}">` +
        `<div class="head"><span class="name">${escapeHtml(m.name)}</span></div>` +
        `<div class="body"><a href="${escapeHtml(encodeHtmlPath(m.outputPath))}">Vorschau öffnen</a></div>` +
        `</div>`;
    }
    cards += '</div>';
    if (hasMailIndex) {
      cards +=
        `<p class="regen" style="margin-top:16px">Index: ` +
        `<a href="mails/index.html">mails/index.html</a> ` +
        `(Kopie von <code>00_index.html</code>)</p>`;
    }
    pushSection(
      'mails',
      catMeta.titel || 'Mail-Vorschauen',
      'scripts/email-previews/realunit',
      `${mailEntries.length} HTML-Dateien`,
      catMeta.beschreibung
        ? escapeHtml(catMeta.beschreibung)
        : 'Aus Template und i18n erzeugte Mail-HTML-Vorschauen.',
      cards,
    );
  }

  // --- Docs (grouped by source directory) ---
  {
    const catMeta = metaLookup(metadata, 'docs');
    const byGroup = new Map();
    for (const d of docEntries) {
      if (!byGroup.has(d.group)) byGroup.set(d.group, []);
      byGroup.get(d.group).push(d);
    }
    const groupKeys = Array.from(byGroup.keys()).sort(sortStrings);
    let body = '';
    for (const g of groupKeys) {
      body += `<h3 class="subgroup">${escapeHtml(g)}</h3>`;
      body += '<ul class="link-list">';
      const list = byGroup.get(g).slice().sort((a, b) => sortStrings(a.title, b.title));
      for (const d of list) {
        body +=
          `<li><a href="${escapeHtml(encodeHtmlPath(d.outputPath))}">${escapeHtml(d.title)}</a>` +
          `<span class="src">${escapeHtml(d.sourcePath)}</span>` +
          (d.beschreibung
            ? `<div style="margin-top:4px;font-size:12.5px;color:var(--ink-3)">${escapeHtml(d.beschreibung)}</div>`
            : '') +
          `</li>`;
      }
      body += '</ul>';
    }
    pushSection(
      'docs',
      catMeta.titel || 'Dokumentation',
      'rekursiver *.md-Scan',
      `${docEntries.length} Dokumente`,
      catMeta.beschreibung
        ? escapeHtml(catMeta.beschreibung)
        : 'Gerenderte Markdown-Dokumentation (via <code>marked</code>), nach Quellverzeichnis gruppiert.',
      body,
    );
  }

  // --- Diagrams ---
  {
    const catMeta = metaLookup(metadata, 'diagrams');
    let body = '<div class="diagram-row">';
    for (const d of diagramEntries) {
      if (d.kind === 'image') {
        body +=
          `<div><a href="${escapeHtml(encodeHtmlPath(d.outputPath))}">` +
          `<img src="${escapeHtml(encodeHtmlPath(d.outputPath))}" alt="${escapeHtml(d.title)}" loading="lazy"></a>` +
          `<p class="regen">${escapeHtml(d.sourcePath)}</p></div>`;
      }
    }
    body += '<div><ul class="link-list">';
    for (const d of diagramEntries) {
      if (d.kind === 'download') {
        body +=
          `<li><a href="${escapeHtml(encodeHtmlPath(d.outputPath))}" download>${escapeHtml(d.title)}</a>` +
          `<span class="src">Download</span></li>`;
      }
    }
    body += '</ul></div></div>';
    pushSection(
      'diagrams',
      catMeta.titel || 'Diagramme',
      'src/subdomains/supporting/dex/docs',
      `${diagramEntries.length} Dateien`,
      catMeta.beschreibung
        ? escapeHtml(catMeta.beschreibung)
        : 'DEX-Modul-Architekturdiagramm (JPG) und editierbare drawio-Quelle.',
      body,
    );
  }

  // --- Assets ---
  {
    const catMeta = metaLookup(metadata, 'assets');
    let ag = '<div class="asset-grid">';
    for (const a of assetEntries) {
      ag +=
        `<div class="asset-card"><a href="${escapeHtml(encodeHtmlPath(a.outputPath))}">` +
        `<img src="${escapeHtml(encodeHtmlPath(a.outputPath))}" alt="${escapeHtml(a.name)}" loading="lazy"></a>` +
        `<div class="an">${escapeHtml(a.name)}</div></div>`;
    }
    ag += '</div>';
    pushSection(
      'assets',
      catMeta.titel || 'Laufzeit-Assets',
      'assets/*.png',
      `${assetEntries.length} PNGs`,
      catMeta.beschreibung
        ? escapeHtml(catMeta.beschreibung)
        : 'Open-CryptoPay-Sticker-Grafiken (OcpStickerService).',
      ag,
    );
  }

  // --- Specs ---
  {
    const catMeta = metaLookup(metadata, 'specs');
    let body = '<ul class="link-list">';
    for (const s of specEntries) {
      const label =
        s.kind === 'download'
          ? `Download ${s.title}`
          : `Dokumentation: ${s.title}`;
      body +=
        `<li><a href="${escapeHtml(encodeHtmlPath(s.outputPath))}">${escapeHtml(label)}</a>` +
        `<span class="src">${escapeHtml(s.sourcePath)}</span></li>`;
    }
    body += '</ul>';
    pushSection(
      'specs',
      catMeta.titel || 'Spezifikationen',
      'src/integration/exchange/docs',
      `${specEntries.length} Einträge`,
      catMeta.beschreibung
        ? escapeHtml(catMeta.beschreibung)
        : 'AsyncAPI-YAML (Download, nicht gerendert) und zugehörige README.',
      body,
    );
  }

  let tocHtml = '<ol>';
  for (const t of tocItems) {
    tocHtml +=
      `<li><a href="#${escapeHtml(t.id)}"><span class="spec-num">${escapeHtml(t.n)}</span>` +
      `${escapeHtml(t.title)}</a></li>`;
  }
  tocHtml += '</ol>';

  const indexHtml =
    `<!DOCTYPE html>\n<html lang="de">\n<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>DFX API Handbook</title>\n` +
    `<style>${css}\n</style>\n` +
    `</head>\n<body>\n` +
    `<div class="wrap">\n` +
    `<aside>\n` +
    `<div class="brand"><span class="dot"></span> DFX API</div>\n` +
    `<p class="brand-sub">Backend Handbook</p>\n` +
    `<div class="toc-label">Inhalt</div>\n` +
    `<div class="toc-actions">` +
    `<button type="button" id="toc-expand-all">Alle öffnen</button>` +
    `<button type="button" id="toc-collapse-all">Alle schliessen</button>` +
    `</div>\n` +
    `<nav class="toc">${tocHtml}</nav>\n` +
    `</aside>\n` +
    `<main>\n` +
    `<header class="hero">\n` +
    `<h1>DFX API Handbook</h1>\n` +
    `<p class="lede">Alle dokumentarischen und visuellen Baseline-Artefakte dieses Backend-Repos an einem Ort: PDF-Beispiele, Mail-Vorschauen, Markdown-Doku, Architekturdiagramme, Laufzeit-Assets und AsyncAPI-Spezifikation. Die Seite wird bei jedem Build per Auto-Discovery erzeugt — neue Artefakte erscheinen ohne Codeänderung.</p>\n` +
    `<div class="callout warn"><p><b>Keine Bild-Baselines.</b> Dieses Repository hat weder Playwright- noch Storybook- noch Visual-Regression-Screenshots und keine <code>__screenshots__</code>-Ordner. Das Handbook zeigt bewusst nur die Artefakte, die tatsächlich existieren. Fehlende Screenshot-Sektionen sind kein Bug.</p></div>\n` +
    `<div class="callout info"><p><b>Auto-Discovery.</b> Es gibt keine handgepflegte Mapping-Tabelle und keinen exakten Count-Guard. Das Build-Script scannt die Quellen rekursiv (mit Ausschlussliste) und erzeugt diese Seite deterministisch. Nur Mindestzahlen (Floor-Guards) schützen vor leeren/korrupten Checkouts.</p></div>\n` +
    `<div class="meta">` +
    `<span>Stand: <b>${escapeHtml(gitSha)}</b></span>` +
    `<span>PDFs: <b>${pdfEntries.length}</b></span>` +
    `<span>Mails: <b>${mailEntries.length}</b></span>` +
    `<span>Docs: <b>${docEntries.length}</b></span>` +
    `<span>Assets: <b>${assetEntries.length}</b></span>` +
    `</div>\n` +
    `</header>\n` +
    `<hr class="sep">\n` +
    sectionsHtml +
    `</main>\n</div>\n` +
    `<script>${script}\n</script>\n` +
    `</body>\n</html>\n`;

  const indexPath = path.join(outDir, 'index.html');
  fs.writeFileSync(indexPath, indexHtml, 'utf8');

  // Stable artifact order for deterministic manifest
  artifacts.sort((a, b) => {
    const c = sortStrings(a.category, b.category);
    if (c !== 0) return c;
    const o = sortStrings(a.outputPath, b.outputPath);
    if (o !== 0) return o;
    return sortStrings(a.title, b.title);
  });

  // counts: real category members only. Skip navigation:true (e.g. mails/index.html)
  // so counts.mails matches mailEntries.length / the index page, not artifacts[].
  // counts.specs intentionally differs from specEntries.length: the companion
  // README is a display entry under specs but lives only under category 'docs'
  // in artifacts[] (avoids double-counting the same file under two categories).
  const counts = { pdfs: 0, mails: 0, docs: 0, diagrams: 0, assets: 0, specs: 0 };
  for (const a of artifacts) {
    if (a.navigation) continue;
    if (Object.prototype.hasOwnProperty.call(counts, a.category)) {
      counts[a.category] += 1;
    }
  }

  const manifest = {
    artifacts,
    gitSha,
    counts,
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Integrity of markdown-authored content: every local reference inside a
  // rendered doc page must point at something that actually exists in the
  // repo. References to real repo files that were not copied into the
  // handbook output are not an error (many docs link to source code or to
  // each other) — only a reference that resolves to nothing in the repo at
  // all is a hard failure.
  for (const d of docEntries) {
    checkDocPageReferences(d, repoRoot, sourceToOutput);
  }

  // Every non-index artifact path in the manifest must exist on disk
  for (const a of artifacts) {
    const full = path.join(outDir, a.outputPath);
    if (!fs.existsSync(full)) {
      fail(`handbook integrity check failed (manifest): missing ${a.outputPath}`);
    }
  }

  console.error(
    `handbook: wrote ${pdfEntries.length} pdfs, ${mailEntries.length} mails, ` +
      `${docEntries.length} docs, ${diagramEntries.length} diagrams, ` +
      `${assetEntries.length} assets, ${specEntries.length} specs → ${outDir}`,
  );
}

main();
