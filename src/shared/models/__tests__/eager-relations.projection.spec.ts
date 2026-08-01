import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
} from 'src/shared/utils/projection-test.util';
import { DataSource, EntityMetadata } from 'typeorm';

const SCHEMA = 'eager_relations_spec';
const SRC = join(__dirname, '../../..');

/**
 * The entities that leave through a controller as themselves, read out of the source.
 *
 * For those the eager relations are not a loading detail — they are the answer. A relation added
 * anywhere in their closure appears in the response; one removed disappears from it.
 *
 * Read rather than listed, because a list goes stale the first time someone adds a controller and
 * nothing says so. It is deliberately generous: any method in a controller file whose return type
 * names an entity counts, decorated or not. A method that is not in fact a handler widens the
 * closure below and costs precision in the failure message; missing a handler would cost the
 * guarantee.
 */
function entitiesReturnedWhole(entities: Set<string>): Map<string, string[]> {
  const controllers: string[] = [];
  const walk = (directory: string): void => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith('.controller.ts')) controllers.push(path);
    }
  };
  walk(SRC);

  const found = new Map<string, string[]>();
  for (const path of controllers) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/\)\s*:\s*(?:Promise<\s*)?([A-Za-z0-9_]+)(?:\[\])?\s*[>{]/g)) {
      const name = match[1];
      if (!entities.has(name)) continue;
      const file = path.slice(SRC.length + 1);
      const where = found.get(name) ?? [];
      if (!where.includes(file)) where.push(file);
      found.set(name, where);
    }
  }

  return found;
}

/**
 * Every eager relation those responses contain, reached recursively.
 *
 * A relation on this list cannot be removed without changing an answer, and one added to any entity
 * on it becomes part of an answer. That is the decision this list exists to force: when it fails,
 * the question is not how to make the test pass but whether the endpoints above should carry the
 * relation.
 */
const IN_A_PAYLOAD = [
  'BankData.preferredCurrency',
  'BankTxRepeat.transaction',
  'BankTxReturn.transaction',
  'BankTxReturn.userData',
  'BuyCrypto.batch',
  'BuyCrypto.fee',
  'BuyCrypto.outputAsset',
  'BuyCrypto.outputReferenceAsset',
  'BuyCrypto.transaction',
  'BuyCryptoBatch.outputAsset',
  'BuyCryptoBatch.outputReferenceAsset',
  'BuyCryptoFee.feeReferenceAsset',
  'BuyFiat.outputAsset',
  'BuyFiat.outputReferenceAsset',
  'BuyFiat.transaction',
  'CryptoInput.asset',
  'CryptoInput.route',
  // The deposit routes share one table, and the metadata of the parent carries the relations of
  // every child. A query on the parent loads all of them, which is why they are on this list.
  'DepositRoute.asset',
  'DepositRoute.deposit',
  'DepositRoute.fiat',
  'DepositRoute.paybackAsset',
  'DepositRoute.paybackDeposit',
  'DepositRoute.rewardAsset',
  'DepositRoute.rewardDeposit',
  'DepositRoute.route',
  'DepositRoute.targetDeposit',
  'Fee.bank',
  'Fee.wallet',
  'FiatOutput.bank',
  'LimitRequest.supportIssue',
  'LiquidityBalance.asset',
  'LiquidityManagementOrder.action',
  'LiquidityManagementOrder.pipeline',
  'LiquidityManagementPipeline.currentAction',
  'LiquidityManagementPipeline.previousAction',
  'LiquidityManagementPipeline.rule',
  'LiquidityManagementRule.deficitStartAction',
  'LiquidityManagementRule.redundancyStartAction',
  'LiquidityManagementRule.targetAsset',
  'LiquidityManagementRule.targetFiat',
  'Organization.country',
  'PaymentLinkPayment.currency',
  'RefReward.outputAsset',
  'RefReward.transaction',
  'SupportIssue.transaction',
  'SupportIssue.transactionRequest',
  'SupportIssue.userData',
  'SupportIssue.wallet',
  'Transaction.user',
  'User.refAsset',
  'UserData.country',
  'UserData.currency',
  'UserData.language',
  'UserData.nationality',
  'UserData.organization',
  'UserData.organizationCountry',
  'UserData.verifiedCountry',
];

/**
 * Eager relations in this repository, counted per entity — an inherited one counts once for each
 * entity that carries it, because that is how often it is loaded.
 */
const EAGER_RELATIONS = 103;

describeProjection('eager relations', () => {
  let dataSource: DataSource;
  let byName: Map<string, EntityMetadata>;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
    byName = new Map(dataSource.entityMetadatas.map((metadata) => [metadata.name, metadata]));
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /**
   * Every eager relation reachable from `roots`, with every root that reaches it.
   *
   * All of them, not the first: `UserData.wallet` is in the answer of the account endpoints and of
   * everything that carries an account, and a message naming one of those sends the reader to the
   * wrong controller.
   */
  function closureOf(roots: string[]): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();

    for (const root of roots) {
      const visited = new Set<string>();
      const pending = [root];

      while (pending.length) {
        const name = pending.pop();
        if (visited.has(name)) continue;
        visited.add(name);

        for (const relation of byName.get(name)?.eagerRelations ?? []) {
          const path = `${name}.${relation.propertyName}`;
          if (!found.has(path)) found.set(path, new Set());
          found.get(path).add(root);
          pending.push(relation.inverseEntityMetadata.name);
        }
      }
    }

    return found;
  }

  it('finds the controllers that answer with an entity', () => {
    // If this reads zero, the search above stopped matching and every assertion below would pass
    // for the wrong reason.
    expect(entitiesReturnedWhole(new Set(byName.keys())).size).toBeGreaterThan(20);
  });

  it('the responses that are entities contain exactly the eager relations recorded here', () => {
    const returned = entitiesReturnedWhole(new Set(byName.keys()));
    const closure = closureOf([...returned.keys()]);

    // Reported with the controllers, because that is the part a diff of relation names does not
    // show: an added relation is a changed response, and this says whose.
    const withOrigin = (paths: string[]): string[] =>
      paths.map((path) => {
        const controllers = [...closure.get(path)].flatMap((origin) => returned.get(origin) ?? []);
        return `${path} — in the answer of ${[...new Set(controllers)].sort().join(', ')}`;
      });

    const added = [...closure.keys()].filter((path) => !IN_A_PAYLOAD.includes(path)).sort();
    expect(withOrigin(added)).toEqual([]);

    const removed = IN_A_PAYLOAD.filter((path) => !closure.has(path)).sort();
    expect(removed).toEqual([]);
  });

  it('has no more eager relations than are recorded', () => {
    const all = dataSource.entityMetadatas.flatMap((metadata) =>
      metadata.eagerRelations.map((relation) => `${metadata.name}.${relation.propertyName}`),
    );

    // Not a limit, a count. Every one of these makes some query load a table it was not asked for,
    // and the point of writing the number down is that adding one is a decision rather than a
    // detail of an unrelated change.
    expect(all.length).toEqual(EAGER_RELATIONS);
  });
});
