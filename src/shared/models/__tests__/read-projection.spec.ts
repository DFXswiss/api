import { readFileSync } from 'fs';
import { join } from 'path';
import { ReadProjection } from 'src/shared/models/read-projection';
import {
  BUY_CRYPTO_BUY_HISTORY_PROJECTION,
  BUY_CRYPTO_ROUTE_HISTORY_PROJECTION,
} from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BUY_FIAT_HISTORY_PROJECTION } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import { USER_PROFILE_PROJECTION } from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { USER_KYC_FILES_PROJECTION } from 'src/subdomains/generic/user/models/user/user.repository';
import { WALLET_KYC_DATA_PROJECTION } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import {
  SUPPORT_ISSUE_DATA_PROJECTION,
  SUPPORT_ISSUE_PROJECTION,
} from 'src/subdomains/supporting/support-issue/repositories/support-issue.repository';
import { SelectQueryBuilder } from 'typeorm';

/** Every endpoint whose `Max cols` in the inventory is the size of a projection. */
const DOCUMENTED: [string, string, ReadProjection<unknown>][] = [
  ['GET', '/user/profile', USER_PROFILE_PROJECTION],
  ['GET', '/buy/:id/history', BUY_CRYPTO_BUY_HISTORY_PROJECTION],
  ['GET', '/swap/:id/history', BUY_CRYPTO_ROUTE_HISTORY_PROJECTION],
  ['GET', '/sell/:id/history', BUY_FIAT_HISTORY_PROJECTION],
  ['GET', '/support/issue/:id/data', SUPPORT_ISSUE_DATA_PROJECTION],
  ['GET', '/support/issue', SUPPORT_ISSUE_PROJECTION],
  ['GET', '/support/issue/:id', SUPPORT_ISSUE_PROJECTION],
  ['GET', '/kyc/users', WALLET_KYC_DATA_PROJECTION],
  ['GET', '/kyc/:id/documents', USER_KYC_FILES_PROJECTION],
];

describe('ReadProjection', () => {
  it('applies the joins and selects exactly the fields it was given', () => {
    const selected: string[][] = [];
    const joined: [string, string][] = [];
    const query = {
      leftJoin: (path: string, alias: string) => {
        joined.push([path, alias]);
        return query;
      },
      select: (fields: string[]) => {
        selected.push(fields);
        return query;
      },
    } as unknown as SelectQueryBuilder<unknown>;

    const projection = new ReadProjection('root', [['root.rel', 'rel']], ['root.a', 'rel.b'], ['root.id']);
    projection.apply(query);

    expect(joined).toEqual([['root.rel', 'rel']]);
    expect(selected).toEqual([['root.a', 'rel.b', 'root.id']]);
  });

  it('keeps the guards when a reduced field list is passed', () => {
    const selected: string[][] = [];
    const query = {
      leftJoin: () => query,
      select: (fields: string[]) => {
        selected.push(fields);
        return query;
      },
    } as unknown as SelectQueryBuilder<unknown>;

    const projection = new ReadProjection('root', [], ['root.a', 'root.b'], ['root.id']);
    // This is what the mutation test does: drop one response field, keep everything else. A guard
    // dropped along with it would make every mutation run fail for the wrong reason.
    projection.apply(query, ['root.a']);

    expect(selected).toEqual([['root.a', 'root.id']]);
  });

  describe('the column counts in docs/endpoints.md', () => {
    // The inventory is the work list and is required to stay in sync with the code. A number
    // written by hand drifts the first time a field is added, and nothing would say so — this reads
    // the document and compares.
    const inventory = readFileSync(join(__dirname, '../../../../docs/endpoints.md'), 'utf8').split('\n');

    it.each(DOCUMENTED)('%s %s matches the projection', (verb, path, projection) => {
      const row = inventory.find((line) => line.startsWith(`| ${verb} |`) && line.includes(`\`${path}\` |`));
      expect(row).toBeDefined();

      const cells = row.split('|').map((cell) => cell.trim());
      const [access, maxCols] = [cells[6], cells[7]];

      expect(access).toEqual('projected');
      expect(+maxCols).toEqual(projection.fields.length + projection.guards.length);
    });
  });
});
