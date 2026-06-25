import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression guards for the MySQL->Postgres migration (#3620) identifier-quoting
 * fixes shipped in the camelCase-quoting PR.
 *
 * The sibling `query-builder-alias.spec.ts` enforces that column references carry
 * an `alias.` prefix, on the assumption that TypeORM then auto-quotes them. That
 * assumption holds ONLY for TypeORM-registered entity aliases. It is false for:
 *   - raw table aliases (`FROM support_message m` inside a `.where(\`...\`)` string)
 *   - `.update('table')` query builders (no entity metadata)
 *   - subquery / derived-table aliases (`.innerJoin(qb => ..., 'latest', '...')`)
 * In those contexts the camelCase identifier must be quoted by hand
 * (`m."issueId"`), or Postgres folds it to lowercase and the query throws at
 * runtime (`column ... does not exist`, `missing FROM-clause entry`). The static
 * scanner cannot tell a registered alias from a raw one, so it passed on the
 * broken code — these guards pin the exact lines that erred in prod.
 *
 * Each guard asserts the KNOWN-BAD (unquoted) form is absent. The quoted form
 * does not match these regexes (the `"` after the dot breaks the pattern), so a
 * silent revert of the quoting re-fails the test.
 */
describe('Postgres identifier quoting (migration regression guards)', () => {
  const srcDir = path.join(__dirname, '..', '..', '..');

  const read = (relPath: string): string => fs.readFileSync(path.join(srcDir, relPath), 'utf-8');

  const guards: { file: string; bad: RegExp; reason: string }[] = [
    // support-issue: raw `FROM support_message m`/`m2` aliases + `userData` join alias
    // inside raw andWhere/subquery strings -> not auto-quoted.
    {
      file: 'subdomains/supporting/support-issue/services/support-issue.service.ts',
      bad: /\bm2?\.issueId\b/,
      reason: 'raw alias m/m2 issueId must be quoted: m."issueId" (else: column m.issueid does not exist)',
    },
    {
      file: 'subdomains/supporting/support-issue/services/support-issue.service.ts',
      bad: /\buserData\.organizationName\b/,
      reason: 'camelCase column on the userData alias in a raw fragment must be quoted: "userData"."organizationName"',
    },
    // deposit-route: alias left unquoted while the column was quoted -> alias folds.
    {
      file: 'subdomains/supporting/address-pool/route/deposit-route.service.ts',
      bad: /\(userData\."paymentLinksConfig"/,
      reason:
        'the userData alias must be quoted too: ("userData"."paymentLinksConfig") (else: missing FROM-clause entry for table "userdata")',
    },
    // bank-data: `.update('bank_data')` -> table-name ref, no metadata to auto-quote.
    {
      file: 'subdomains/generic/user/models/bank-data/bank-data.service.ts',
      bad: /\bbank_data\.userDataId\b/,
      reason:
        'update-QB table ref must be quoted: bank_data."userDataId" (else: column bank_data.userdataid does not exist)',
    },
    // payment-link-payment: subquery/derived alias `latest` + raw join condition.
    {
      file: 'subdomains/core/payment-link/services/payment-link-payment.service.ts',
      bad: /\b(?:plp2?|latest)\.(?:linkId|maxId)\b/,
      reason:
        'subquery/derived alias columns must be quoted: latest."linkId" / plp."linkId" / latest."maxId" (else: column latest.linkid does not exist)',
    },
    // ref-reward: MySQL ROUND(double, int) signature has no Postgres overload.
    {
      file: 'subdomains/core/referral/reward/services/ref-reward.service.ts',
      bad: /ROUND\(SUM\(r\.amountInChf\)\s*,/,
      reason:
        'ROUND on a double needs a numeric cast: ROUND(SUM(r.amountInChf)::numeric, 0) (else: function round(double precision, integer) does not exist)',
    },
  ];

  it.each(guards)('does not reintroduce an unquoted identifier in $file', ({ file, bad, reason }) => {
    const content = read(file);
    const match = bad.exec(content);
    expect(match ? `${file}: found "${match[0]}" — ${reason}` : null).toBeNull();
  });
});
