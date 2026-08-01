import { readFileSync } from 'fs';
import { join } from 'path';
import { ReadProjection } from 'src/shared/models/read-projection';
import {
  BUY_CRYPTO_BUY_HISTORY_PROJECTION,
  BUY_CRYPTO_ROUTE_HISTORY_PROJECTION,
} from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { CUSTODY_ORDER_HISTORY_PROJECTION } from 'src/subdomains/core/custody/repositories/custody-order.repository';
import { PIPELINE_STATUS_PROJECTION } from 'src/subdomains/core/liquidity-management/repositories/liquidity-management-pipeline.repository';
import { POS_LINK_PROJECTION } from 'src/subdomains/core/payment-link/repositories/payment-link.repository';
import { SUSPENSE_LEG_PROJECTION } from 'src/subdomains/core/accounting/repositories/ledger-leg.repository';
import { BUY_FIAT_HISTORY_PROJECTION } from 'src/subdomains/core/sell-crypto/process/buy-fiat.repository';
import {
  API_KEY_PROJECTION,
  USER_PROFILE_PROJECTION,
  USER_V2_PROJECTION,
} from 'src/subdomains/generic/user/models/user-data/user-data.repository';
import { USER_KYC_FILES_PROJECTION } from 'src/subdomains/generic/user/models/user/user.repository';
import { WALLET_KYC_DATA_PROJECTION } from 'src/subdomains/generic/user/models/wallet/wallet.repository';
import {
  SUPPORT_ISSUE_DATA_PROJECTION,
  SUPPORT_ISSUE_LIST_PROJECTION,
  SUPPORT_ISSUE_PROJECTION,
} from 'src/subdomains/supporting/support-issue/repositories/support-issue.repository';
import { SelectQueryBuilder } from 'typeorm';

/**
 * Every endpoint whose `Max cols` in the inventory is the size of a projection.
 *
 * The version is part of the key: `/user` exists twice, and only the v2 handler is projected.
 */
const DOCUMENTED: [string, string, string, ReadProjection<unknown>][] = [
  ['GET', '2', '/user/profile', USER_PROFILE_PROJECTION],
  ['GET', '2', '/user', USER_V2_PROJECTION],
  ['POST', '1', '/user/apiKey/CT', API_KEY_PROJECTION],
  ['GET', '1', '/buy/:id/history', BUY_CRYPTO_BUY_HISTORY_PROJECTION],
  ['GET', '1', '/swap/:id/history', BUY_CRYPTO_ROUTE_HISTORY_PROJECTION],
  ['GET', '1', '/sell/:id/history', BUY_FIAT_HISTORY_PROJECTION],
  ['GET', '1', '/support/issue/:id/data', SUPPORT_ISSUE_DATA_PROJECTION],
  ['GET', '1', '/support/issue', SUPPORT_ISSUE_PROJECTION],
  ['GET', '1', '/support/issue/:id', SUPPORT_ISSUE_PROJECTION],
  ['GET', '1', '/support/issue/list', SUPPORT_ISSUE_LIST_PROJECTION],
  ['GET', '1', '/realunit/support/list', SUPPORT_ISSUE_LIST_PROJECTION],
  ['GET', '1', '/kyc/users', WALLET_KYC_DATA_PROJECTION],
  ['GET', '1', '/kyc/:id/documents', USER_KYC_FILES_PROJECTION],
  ['GET', '1', '/custody/order', CUSTODY_ORDER_HISTORY_PROJECTION],
  ['GET', '1', '/dashboard/accounting/ledger/suspense', SUSPENSE_LEG_PROJECTION],
  ['GET', '1', '/liquidityManagement/pipeline/:id/status', PIPELINE_STATUS_PROJECTION],
  ['PUT', '1', '/paymentLink/:id/pos', POS_LINK_PROJECTION],
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

  it('applies a join declared as inner as an inner join', () => {
    const joined: [string, string, string][] = [];
    const query = {
      leftJoin: (path: string, alias: string) => {
        joined.push([path, alias, 'left']);
        return query;
      },
      innerJoin: (path: string, alias: string) => {
        joined.push([path, alias, 'inner']);
        return query;
      },
      select: () => query,
    } as unknown as SelectQueryBuilder<unknown>;

    new ReadProjection(
      'root',
      [
        ['root.a', 'a'],
        ['root.b', 'b', 'inner'],
      ],
      ['a.x', 'b.y'],
    ).apply(query);

    expect(joined).toEqual([
      ['root.a', 'a', 'left'],
      ['root.b', 'b', 'inner'],
    ]);
  });

  it('refuses a field list naming an alias it does not join', () => {
    // The guard watches the aliases the projection declares. A relation joined on the query builder
    // instead is selected but unwatched, so reading a column it did not select answers undefined
    // rather than throwing — the exact defect this whole suite exists to make loud.
    expect(() => new ReadProjection('root', [], ['root.a', 'rel.b'])).toThrow(
      "projection 'root' names aliases it does not join: 'rel'",
    );
    // Guards are checked too: they are selected columns like any other, and a guard on an unjoined
    // alias is the same silent hole.
    expect(() => new ReadProjection('root', [['root.rel', 'rel']], ['root.a'], ['other.id'])).toThrow("'other'");
  });

  it('every projection in the inventory joins each alias its fields name', () => {
    // Asserted over the real projections rather than a constructed one: the rule above only helps
    // if it holds for what the endpoints actually use.
    for (const [method, version, path, projection] of DOCUMENTED) {
      const declared = new Set([projection.alias, ...projection.joins.map(([, alias]) => alias)]);
      const named = [...projection.fields, ...projection.guards].map((field) => field.split('.')[0]);

      expect({ endpoint: `${method} v${version} ${path}`, undeclared: named.filter((a) => !declared.has(a)) }).toEqual({
        endpoint: `${method} v${version} ${path}`,
        undeclared: [],
      });
    }
  });

  describe('the column counts in docs/endpoints.md', () => {
    // The inventory is the work list and is required to stay in sync with the code. A number
    // written by hand drifts the first time a field is added, and nothing would say so — this reads
    // the document and compares.
    const inventory = readFileSync(join(__dirname, '../../../../docs/endpoints.md'), 'utf8').split('\n');

    it.each(DOCUMENTED)('%s v%s %s matches the projection', (verb, version, path, projection) => {
      const row = inventory.find((line) => {
        const cells = line.split('|').map((cell) => cell.trim());
        return cells[1] === verb && cells[2] === version && cells[4] === `\`${path}\``;
      });
      expect(row).toBeDefined();

      const cells = row.split('|').map((cell) => cell.trim());
      const [access, maxCols] = [cells[6], cells[7]];

      expect(access).toEqual('projected');
      expect(+maxCols).toEqual(projection.fields.length + projection.guards.length);
    });
  });
});
