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
    // Block 5 (§10.2 robustness gap) — the two write paths the old gate structurally missed
    { name: 'getRepository(X).save write path', code: 'await dataSource.getRepository(BankTx).save({});' },
    { name: 'getRepository(X).update write path', code: 'await dataSource.getRepository(BankTx).update(id, dto);' },
    { name: 'source-service write update(', code: 'await bankTxService.update(id, dto);' },
    { name: 'source-service write updateAsset(', code: 'await assetService.updateAsset(a);' },
    { name: 'source-service write save(', code: 'await bankTxService.save(e);' },
    // Block 6/7 (§10.2 robustness gap, Major design-accounting) — the write/external paths the old gate missed
    { name: 'dataSource.query raw write path', code: 'await dataSource.query("UPDATE bank_tx SET x = 1");' },
    {
      // queryRunner.query is the idiomatic TypeORM raw-write path (dataSource.createQueryRunner().query(...)) and
      // carries no manager/dataSource token → previously unflagged (Block 6 gap, Major design-accounting)
      name: 'queryRunner.query raw write path',
      code: 'await queryRunner.query("UPDATE bank_tx SET amount = 0");',
    },
    {
      name: 'entityManager.save on a business entity (\\bmanager. missed it — no word boundary)',
      code: 'await entityManager.save(BankTx, x);',
    },
    { name: 'entityManager.query raw write path', code: 'await entityManager.query("INSERT INTO bank_tx ...");' },
    {
      name: 'QueryBuilder write xRepo.createQueryBuilder().update(BankTx)',
      code: 'await xRepo.createQueryBuilder().update(BankTx).set({ x: 1 }).execute();',
    },
    {
      name: 'QueryBuilder write dataSource.createQueryBuilder().insert().into(BankTx)',
      code: 'await dataSource.createQueryBuilder().insert().into(BankTx).execute();',
    },
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
    // Block 5 must NOT flag the legit ledger READ via getRepository (no write verb) nor sanctioned service reads
    {
      name: 'ledger READ via getRepository(LedgerTx).createQueryBuilder (booking nextSeq)',
      code: 'this.dataSource.getRepository(LedgerTx).createQueryBuilder("tx");',
    },
    {
      name: 'sanctioned service read accountService.findOrCreate',
      code: 'await accountService.findOrCreate(n, t, c);',
    },
    { name: 'sanctioned service read assetService.getAssetsWith', code: 'await assetService.getAssetsWith(w);' },
    // Block 7 must NOT flag a READ QueryBuilder chain (.select/.where/.getRawOne — the ledger nextSeq/recon queries)
    {
      name: 'read QueryBuilder chain createQueryBuilder().select().where()',
      code: 'await repo.createQueryBuilder("e").select("MAX(e.id)", "max").where("x").getRawOne();',
    },
    // Block 6 must NOT flag a read on the dataSource via a non-write method (transaction wrapper / find)
    {
      name: 'dataSource.transaction wrapper (not a write verb)',
      code: 'await dataSource.transaction(async (m) => m);',
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

  // --- SOURCE-REPO NAMING CONVENTION (§4.10 Block 4a / Minor R3-9, Major isolation gap) --- //
  //
  // Block 4a flags a non-ledger repo write via `\b(?!ledger)\w*Repo(sitory)?\.<write>(` — i.e. it only catches an
  // identifier that ENDS in `Repo`/`Repository`. A write through a generically-named injected source repo (e.g.
  // `private readonly src: Repository<BankTx>` → `src.save(e)`, or `feed`) carries no `Repo` token and escapes ALL
  // blocks (empirically: `src.save(entity)` / `this.source.update(id, dto)` pass clean). Block 4a's coverage of
  // every source repo therefore RESTS on the naming convention that all injected source repos end in `Repo`/
  // `Repository` (the same naming mandate §4.10 already places on the ledger* repos). This self-test enforces that
  // convention statically: every `@InjectRepository(<Entity>)` binding in the module source MUST name its field
  // `*Repo`/`*Repository`, so the gate's grep can never structurally miss a future source-repo write.

  // collects every accounting-module source .ts file (production only — *.spec.ts/__tests__/__mocks__ excluded)
  function collectSourceFiles(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
        collectSourceFiles(full, out);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        out.push(full);
      }
    }
  }

  it('every @InjectRepository binding in the module is named *Repo/*Repository (Block 4a coverage rests on it)', () => {
    const files: string[] = [];
    collectSourceFiles(MODULE_DIR, files);

    // matches `@InjectRepository(Entity) ... <field>: Repository<...>` across one or two physical lines (some
    // bindings wrap the @InjectRepository decorator onto its own line) — captures the bound field identifier
    const bindingRe =
      /@InjectRepository\([^)]*\)[\s\S]*?(?:private|public|protected|readonly)\s+(?:readonly\s+)?(\w+)\s*:/g;

    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(bindingRe)) {
        const field = m[1];
        if (!/Repo(sitory)?$/.test(field)) {
          offenders.push(`${path.relative(MODULE_DIR, file)}: ${field}`);
        }
      }
    }

    expect(offenders).toEqual([]); // any generically-named source repo would silently escape Block 4a
  });

  it('a write via a *Repo-suffixed source repo IS flagged (the convention makes Block 4a reliable)', () => {
    const result = gateOnFixture('repo-write.ts', 'export function f() {\n  await sourceRepo.save(e);\n}\n');
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/FORBIDDEN/);
  });

  it('documents the gap: a write via a generically-named source repo (no *Repo suffix) escapes the grep gate', () => {
    // this is WHY the naming convention is enforced above — the gate alone cannot catch this, so the *Repo suffix is
    // mandatory; the per-binding self-test is the actual defense line for future generically-named injections.
    const result = gateOnFixture('generic-write.ts', 'export function f() {\n  await src.save(e);\n}\n');
    expect(result.exitCode).toBe(0); // grep cannot see it → the naming-convention test is what prevents it
  });
});
