import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../..');
const GATE = path.join(REPO_ROOT, 'scripts', 'ledger-isolation-gate.sh');
const MODULE_DIR = path.join(REPO_ROOT, 'src', 'subdomains', 'core', 'accounting');

/**
 * §4.10 / §10.1 — the static CI grep-gate (ledger-isolation-gate.sh) self-test. Asserts (a) the accounting MODULE
 * source is clean today, and (b) the wrapped gate (PCRE2 engine PLUS the `| grep -v 'ledger-allowlist'` post-filter,
 * §10.3 Minor R4-1) flags every known violation and passes every known-allowed construct — so a silently broken
 * gate (missing --pcre2, defused pattern) cannot pass unnoticed. The test runs against the WRAPPED gate SCRIPT,
 * not the raw pattern: the raw Block-4b pattern flags even `manager.save(LedgerTx, tx) // ledger-allowlist`; only
 * the post-filter clears it.
 */
describe('Ledger isolation gate (§4.10 / §10.1 self-test)', () => {
  // runs the gate over a target dir; returns { exitCode, output }
  function runGate(targetDir: string): { exitCode: number; output: string } {
    try {
      const out = execFileSync('bash', [GATE, targetDir], { cwd: REPO_ROOT, encoding: 'utf8' });
      return { exitCode: 0, output: out };
    } catch (e: any) {
      return { exitCode: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  // writes a fixture .ts file into a fresh temp dir and runs the gate against that dir
  function gateOnFixture(filename: string, content: string): { exitCode: number; output: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-gate-'));
    try {
      fs.writeFileSync(path.join(dir, filename), content);
      return runGate(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('passes over the real accounting module source (clean today)', () => {
    const result = runGate(MODULE_DIR);
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/clean/);
  });

  // --- KNOWN VIOLATIONS MUST FLAG (§10.1, Major R3-1 / R9-1 / Minor R9-1) --- //

  const violations: { name: string; code: string }[] = [
    { name: 'manager.save on a business entity without allowlist', code: 'manager.save(BankTx, e);' },
    { name: 'forbidden pricing read getPrice(', code: 'const p = getPrice(asset, CHF, ANY);' },
    { name: 'forbidden pricing read getPriceAt', code: 'const p = this.x.getPriceAt(a, d);' },
    { name: 'pricingService reference', code: 'this.pricingService.convert(x);' },
    { name: 'a non-ledger repo write', code: 'await bankTxRepo.save(entity);' },
    { name: 'logService.create write into the FinancialDataLog table', code: 'await logService.create(dto);' },
    { name: 'logService.update write into the FinancialDataLog table', code: 'await logService.update(dto);' },
    { name: 'settingService.setObj write with operative side effect', code: 'await settingService.setObj(k, v);' },
    {
      name: 'settingService.updateProcess write with operative side effect',
      code: 'await settingService.updateProcess(d);',
    },
    { name: 'external feed call refreshBalances(', code: 'await this.liqBalance.refreshBalances(rules);' },
    { name: 'external feed call refreshBankBalance', code: 'await svc.refreshBankBalance(dto);' },
    { name: 'external feed call hasPendingOrders', code: 'await svc.hasPendingOrders(rule);' },
    { name: 'lifecycle call .complete(', code: 'await order.complete();' },
    { name: 'lifecycle call doPayout', code: 'await this.payoutService.doPayout(o);' },
    { name: 'manager.query raw write path', code: 'await manager.query("UPDATE bank_tx SET x = 1");' },
    { name: 'EntityManager update on a business entity', code: 'await manager.update(BankTx, id, { x: 1 });' },
  ];

  it.each(violations)('flags a known violation: $name', ({ code }) => {
    const result = gateOnFixture('violation.ts', `export function f() {\n  ${code}\n}\n`);
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/FORBIDDEN/);
  });

  // --- KNOWN-ALLOWED CONSTRUCTS MUST NOT FLAG (§10.1) --- //

  const allowed: { name: string; code: string }[] = [
    {
      name: 'allowlisted manager write into ledger_* (post-filter clears it)',
      code: 'await manager.save(LedgerTx, tx); // ledger-allowlist',
    },
    {
      name: 'allowlisted manager.insert into ledger_*',
      code: 'await manager.insert(LedgerLeg, legs); // ledger-allowlist',
    },
    { name: 'whitelisted feed read getBalances()', code: 'const b = await this.liqBalance.getBalances();' },
    {
      name: 'whitelisted feed read getAllLiqBalancesForAssets',
      code: 'const b = await this.liqBalance.getAllLiqBalancesForAssets(ids);',
    },
    { name: 'settingService.set for a ledger key', code: 'await settingService.set("ledgerCutoverLogId", id);' },
    { name: 'settingService.get for a ledger key', code: 'const v = await settingService.get(k);' },
    { name: 'settingService.getObj for a ledger key', code: 'const v = await settingService.getObj(k);' },
    { name: 'read-only logService.getFinancialLogs', code: 'const r = await logService.getFinancialLogs(from);' },
    { name: 'ledger-own repository write', code: 'await ledgerTxRepository.save(tx);' },
    { name: 'the ledger mark lookup getMarkAt (not getPriceAt)', code: 'const m = marks.getMarkAt(id, date);' },
    {
      name: 'a notification alarm via sendMail (sanctioned, not a *Repo.save)',
      code: 'await notificationService.sendMail(req);',
    },
  ];

  it.each(allowed)('does NOT flag an allowed construct: $name', ({ code }) => {
    const result = gateOnFixture('allowed.ts', `export function f() {\n  ${code}\n}\n`);
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/clean/);
  });

  // --- POST-FILTER LOAD-BEARING (Minor R4-1): the raw Block-4b pattern would flag the allowlisted line --- //

  it('clears an allowlisted ledger manager.save but still flags a non-allowlisted manager.save in the same file', () => {
    const code = [
      'export function f() {',
      '  await manager.save(LedgerTx, tx); // ledger-allowlist',
      '  await manager.save(BankTx, e);',
      '}',
      '',
    ].join('\n');
    const result = gateOnFixture('mixed.ts', code);
    expect(result.exitCode).toBe(1); // the non-allowlisted manager.save remains
    expect(result.output).toContain('manager.save(BankTx, e)');
    expect(result.output).not.toContain('ledger-allowlist'); // the allowlisted line is filtered out of the matches
  });
});
