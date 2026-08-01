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
 * The entities that leave through a controller as themselves — for those, the eager relations are
 * the response rather than a loading detail.
 *
 * Read out of the source rather than listed, so that adding a controller cannot narrow the closure
 * silently. Deliberately generous: any method in a controller file whose return type names an
 * entity counts. An over-match costs precision in the message, a miss costs the guarantee.
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
    // The whole return type, then every entity name in it: `Promise<Issue | null>`, `Promise<Issue[]>`
    // and any wrapper around them all have to count. Matching the first identifier after the colon
    // reads more simply and silently misses the union forms — the expensive direction, because a
    // handler it misses is one whose answer the closure below then fails to cover.
    for (const match of source.matchAll(/\)\s*:\s*([^;{]+?)\s*\{/g)) {
      for (const identifier of match[1].match(/[A-Za-z0-9_]+/g) ?? []) {
        if (!entities.has(identifier)) continue;
        const file = path.slice(SRC.length + 1);
        const where = found.get(identifier) ?? [];
        if (!where.includes(file)) where.push(file);
        found.set(identifier, where);
      }
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
