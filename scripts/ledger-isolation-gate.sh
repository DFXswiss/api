#!/bin/bash

# Ledger isolation gate (§4.10 R2 / §10.3) — the CI grep-gate that enforces the Hard Constraints of the
# accounting module statically: no pricing/HTTP, no feed-read/external-balance call, no lifecycle/strategy call,
# and no write on any non-ledger_* table (repository OR EntityManager path).
#
# It is a WRAPPER, not the raw pattern (Minor R4-1): the raw Block-4b pattern flags EVERY `manager`-write line
# incl. the allowlisted ledger-own writes; the post-filter removes the lines carrying the exact `// ledger-allowlist`
# marker (the only sanctioned manager-writes, into ledger_*). The gate prints every offending `file:line:match` and
# exits non-zero when ANY offending line remains.
#
# Engine (§10.3 Minor R3-2): the negative-lookahead `(?!ledger)` is PCRE2-only → grep -P / rg --pcre2. The gate
# picks the first available PCRE2 engine (rg --pcre2, then grep -P / ggrep -P) and ONLY if none is available falls
# back to the bundled Node implementation (scripts/ledger-isolation-gate.js, identical pattern + post-filter) — so
# the gate ALWAYS runs (never a silent no-op), regardless of host grep flavour (macOS BSD grep has no -P).
#
# Usage:
#   ./scripts/ledger-isolation-gate.sh [TARGET_DIR]
# TARGET_DIR defaults to src/subdomains/core/accounting (the §10.1 self-test passes a fixtures dir). Only the
# module SOURCE is scanned — *.spec.ts / __tests__ / __mocks__ are excluded (tests legitimately reference mocked
# services and the in-memory ledger uses manager.save).

set -u

TARGET_DIR="${1:-src/subdomains/core/accounting}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# the 7-block forbidden pattern (§4.10); \b word-boundary anchors keep the method tokens injection-name-independent
PATTERN='pricingService|PricingService|getPrice\(|getPriceAt|priceProvider|CoinGecko|HttpService'
PATTERN+='|\brefreshBalances\(|\brefreshBankBalance|\bhasPendingOrders|integration\.getBalances|integration\.hasPendingOrders|BankAdapter|balanceIntegrationFactory|LiquidityBalanceIntegrationFactory'
PATTERN+='|\blogService\.(create|update)\(|\bsettingService\.(setObj|updateProcess|addIpToBlacklist|deleteIpFromBlacklist)\('
PATTERN+='|\.complete\(|checkOrderCompletion|syncExchanges|doPayout|checkPayoutCompletionData|triggerWebhook|calculateSpreadFee'
PATTERN+='|balanceRepo\.(update|save|insert|delete|remove)\(|\b(?!ledger)\w*Repo(sitory)?\.(update|save|insert|delete|remove)\('
# Block 6 (EntityManager + raw-SQL write paths — robustness gap §10.2): `\w*[Mm]anager.<write>(` catches the
# idiomatic injected EntityManager regardless of binding identifier — manager.save, entityManager.save,
# dataSource.manager.save (the bare `\bmanager.` missed `entityManager.` — there is no word boundary inside the
# identifier). `dataSource.query(` AND `queryRunner.query(` join `\w*[Mm]anager.query(` so a raw UPDATE/INSERT SQL
# write via ANY of the three escape hatches is flagged (`queryRunner` is the idiomatic TypeORM write path —
# `dataSource.createQueryRunner().query(...)`, exactly the migration pattern — and carries no `manager`/`dataSource`
# token, so it was previously unflagged). The allowlisted ledger-own `manager.save(LedgerTx,…) // ledger-allowlist`
# is cleared by the post-filter.
PATTERN+='|\b\w*[Mm]anager\.(save|insert|update|delete|remove|upsert|softDelete|softRemove|recover|query)\(|\bdataSource\.query\(|\bqueryRunner\.query\('
# Block 5 (getRepository-write + source-Service-write — robustness gap §10.2): a write via dataSource.getRepository(X)
# (e.g. getRepository(BankTx).save(...)) escapes Block 4a (the token before `.save` is `getRepository(...)`, not a
# `*Repo`/`*Repository` identifier); a write via an injected source-domain service method with a generic write name
# (e.g. bankTxService.update(...), assetService.updateAsset(...)) is not named in Blocks 2/3. Both are flagged here.
# Sanctioned service calls (settingService.set, notificationService.sendMail, logService.get*, *Service.find*/get*/
# bookTx/preload/…) do NOT match — their method names are not save/insert/update/delete/remove/upsert*. The legit
# ledger READ `getRepository(LedgerTx).createQueryBuilder()` (booking-service nextSeq) is NOT matched (no write verb).
PATTERN+='|getRepository\([^)]*\)\.(save|insert|update|delete|remove|upsert|softDelete|softRemove|recover)\(|\b\w+Service\.(save|insert|update|delete|remove|upsert)\w*\('
# Block 7 (QueryBuilder write path — robustness gap §10.2): a write via the QueryBuilder DSL
# `xRepo.createQueryBuilder().update(BankTx).set(...).execute()` or `dataSource.createQueryBuilder().insert().into(BankTx)`
# escapes Block 4a/5 (the verb is .update/.insert ON the builder, not directly after `Repo.`/`getRepository(...)`). Only
# the WRITE verbs are flagged — a read QB chain (.select/.where/.getRawOne, e.g. the ledger nextSeq / reconciliation
# queries) is NOT matched.
PATTERN+='|\.createQueryBuilder\([^)]*\)\.(update|insert|delete|softDelete)\('

# excludes test/mock files: the gate scans production source only (tests reference mocked services intentionally)
EXCLUDES=(--include='*.ts' --exclude='*.spec.ts' --exclude-dir='__tests__' --exclude-dir='__mocks__')

run_grep() { # $1 = grep binary
  "$1" -rPn "${EXCLUDES[@]}" "$PATTERN" "$TARGET_DIR" 2>/dev/null | grep -v 'ledger-allowlist'
}

pcre2_grep() {
  for g in grep ggrep; do
    if command -v "$g" >/dev/null 2>&1 && printf 'x' | "$g" -P 'x' >/dev/null 2>&1; then
      echo "$g"
      return 0
    fi
  done
  return 1
}

MATCHES=""
if command -v rg >/dev/null 2>&1 && rg --pcre2 --version >/dev/null 2>&1; then
  MATCHES="$(rg --pcre2 -n -g '*.ts' -g '!*.spec.ts' -g '!__tests__' -g '!__mocks__' "$PATTERN" "$TARGET_DIR" 2>/dev/null | grep -v 'ledger-allowlist')"
elif GREP_BIN="$(pcre2_grep)"; then
  MATCHES="$(run_grep "$GREP_BIN")"
else
  # no PCRE2 grep/rg on this host (e.g. macOS BSD grep) → bundled Node fallback (identical pattern + post-filter)
  MATCHES="$(node "$SCRIPT_DIR/ledger-isolation-gate.js" "$TARGET_DIR")"
fi

if [ -n "$MATCHES" ]; then
  echo "ledger-isolation-gate: FORBIDDEN constructs found in $TARGET_DIR (§4.10):" >&2
  echo "$MATCHES" >&2
  exit 1
fi

echo "ledger-isolation-gate: clean ($TARGET_DIR)"
exit 0
