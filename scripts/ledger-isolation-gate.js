#!/usr/bin/env node
/* eslint-disable */

// Node implementation of the ledger isolation gate (§4.10 R2 / §10.3) — the bundled fallback used by
// ledger-isolation-gate.sh on hosts WITHOUT a PCRE2-capable grep/rg (e.g. macOS BSD grep). It applies the
// IDENTICAL 4-block forbidden pattern as the shell gate plus the `// ledger-allowlist` post-filter (Minor R4-1),
// scanning the module SOURCE only (*.ts, excluding *.spec.ts / __tests__ / __mocks__). JavaScript's regex engine
// supports the (?!ledger) negative-lookahead natively → never a silent no-op. Prints `file:line:match` per
// offending line and exits 1 when any remains.
//
// Usage: node scripts/ledger-isolation-gate.js [TARGET_DIR]

const fs = require('fs');
const path = require('path');

const TARGET_DIR = process.argv[2] || 'src/subdomains/core/accounting';

// the 7-block forbidden pattern (§4.10) — kept char-for-char equivalent to the shell PATTERN
const PATTERN = new RegExp(
  [
    'pricingService|PricingService|getPrice\\(|getPriceAt|priceProvider|CoinGecko|HttpService',
    '\\brefreshBalances\\(|\\brefreshBankBalance|\\bhasPendingOrders|integration\\.getBalances|integration\\.hasPendingOrders|BankAdapter|balanceIntegrationFactory|LiquidityBalanceIntegrationFactory',
    '\\blogService\\.(create|update)\\(|\\bsettingService\\.(setObj|updateProcess|addIpToBlacklist|deleteIpFromBlacklist)\\(',
    '\\.complete\\(|checkOrderCompletion|syncExchanges|doPayout|checkPayoutCompletionData|triggerWebhook|calculateSpreadFee',
    'balanceRepo\\.(update|save|insert|delete|remove)\\(|\\b(?!ledger)\\w*Repo(sitory)?\\.(update|save|insert|delete|remove)\\(',
    // Block 6 (EntityManager + raw-SQL write paths, Major design-accounting): `\w*[Mm]anager.<write>(` catches the
    // idiomatic injected EntityManager regardless of the binding identifier — `manager.save`, `entityManager.save`,
    // `dataSource.manager.save` (the bare `\bmanager.` missed `entityManager.` because there is no word boundary
    // inside the identifier). `dataSource.query(` AND `queryRunner.query(` join `\w*[Mm]anager.query(` so a raw
    // `UPDATE/INSERT` SQL write via ANY of the three escape hatches is flagged (`queryRunner` is the idiomatic
    // TypeORM write path — `dataSource.createQueryRunner().query(...)`, exactly the migration pattern — and carries
    // no `manager`/`dataSource` token, so it was previously unflagged). The allowlisted ledger-own
    // `manager.save(LedgerTx,…) // ledger-allowlist` is cleared by the post-filter.
    '\\b\\w*[Mm]anager\\.(save|insert|update|delete|remove|upsert|softDelete|softRemove|recover|query)\\(|\\bdataSource\\.query\\(|\\bqueryRunner\\.query\\(',
    // Block 5 (§10.2 robustness gap): getRepository(X).<write>(…) escapes Block 4a (token before `.save` is
    // getRepository(...), not a *Repo identifier); a source-service write with a generic name (bankTxService.update,
    // assetService.updateAsset) is not named in Blocks 2/3. The legit ledger READ getRepository(LedgerTx).
    // createQueryBuilder() is not matched (no write verb); sanctioned service calls (set/sendMail/get*/find*/…) too.
    'getRepository\\([^)]*\\)\\.(save|insert|update|delete|remove|upsert|softDelete|softRemove|recover)\\(|\\b\\w+Service\\.(save|insert|update|delete|remove|upsert)\\w*\\(',
    // Block 7 (QueryBuilder write path, Major design-accounting): a write via the QueryBuilder DSL
    // `xRepo.createQueryBuilder().update(BankTx).set(...).execute()` or
    // `dataSource.createQueryBuilder().insert().into(BankTx).execute()` escapes Block 4a/5 (the verb is .update/.insert
    // ON the builder, not directly after `Repo.`/`getRepository(...)`). Only the WRITE verbs are flagged — a read QB
    // chain (.select/.where/.getRawOne, e.g. the ledger nextSeq / reconciliation queries) is NOT matched.
    '\\.createQueryBuilder\\([^)]*\\)\\.(update|insert|delete|softDelete)\\(',
  ].join('|'),
);

const ALLOWLIST_MARKER = 'ledger-allowlist';

function isTestPath(p) {
  return p.endsWith('.spec.ts') || p.includes('/__tests__/') || p.includes('/__mocks__/');
}

function collectTsFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // missing dir → nothing to scan (the caller treats "no matches" as clean)
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      collectTsFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !isTestPath(full)) {
      out.push(full);
    }
  }
}

const matches = [];
const stat = (() => {
  try {
    return fs.statSync(TARGET_DIR);
  } catch {
    return undefined;
  }
})();

const files = [];
if (stat?.isDirectory()) {
  collectTsFiles(TARGET_DIR, files);
} else if (stat?.isFile() && TARGET_DIR.endsWith('.ts') && !isTestPath(TARGET_DIR)) {
  files.push(TARGET_DIR);
}

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (PATTERN.test(line) && !line.includes(ALLOWLIST_MARKER)) {
      matches.push(`${file}:${i + 1}:${line.trim()}`);
    }
  });
}

if (matches.length) {
  // stdout so the shell wrapper captures it identically to the grep path; the wrapper prints it to stderr + exits 1
  console.log(matches.join('\n'));
  process.exit(1);
}

process.exit(0);
