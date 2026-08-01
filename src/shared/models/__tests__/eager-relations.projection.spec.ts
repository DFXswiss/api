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
 * Read out of the source rather than listed, so that a controller added later is covered without
 * anyone remembering a list. Deliberately generous: any method in a controller file whose return
 * type names an entity counts, including through a renamed import. An over-match costs precision
 * in the message, a miss costs the guarantee.
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
    for (const name of entitiesReturnedBy(readFileSync(path, 'utf8'), entities)) {
      const file = path.slice(SRC.length + 1);
      const where = found.get(name) ?? [];
      if (!where.includes(file)) where.push(file);
      found.set(name, where);
    }
  }

  return found;
}

/**
 * The entities one controller file answers with, by their own names.
 *
 * Separate from the walk above so it can be exercised on source text rather than on whatever the
 * repository happens to contain today — the alias case has no instance here yet, and a guard whose
 * hardest branch never runs is the thing this suite exists to argue against.
 */
export function entitiesReturnedBy(source: string, entities: Set<string>): Set<string> {
  // `import { SupportIssue as Issue }` — the handler then names `Issue`, which is not an entity
  // name and would drop out of the scan. Mapped back, so renaming an import cannot quietly remove
  // a controller from the closure.
  const renamed = new Map<string, string>();
  // The other direction of the same clause: a local name that happens to match an entity while
  // standing for something else. Counting it would attribute relations to a response that never
  // carries them.
  const shadowed = new Set<string>();
  for (const clause of source.matchAll(/import\s*\{([^}]*)\}/g))
    for (const part of clause[1].split(',')) {
      const [original, alias] = part.split(/\s+as\s+/).map((piece) => piece.trim());
      if (!alias) continue;
      if (entities.has(original)) renamed.set(alias, original);
      else shadowed.add(alias);
    }

  const found = new Set<string>();
  // The whole return type, then every entity name in it: `Promise<Issue | null>`, `Promise<Issue[]>`
  // and any wrapper around them all have to count. Matching the first identifier after the colon
  // reads more simply and silently misses the union forms — the expensive direction, because a
  // handler it misses is one whose answer the closure below then fails to cover.
  for (const match of source.matchAll(/\)\s*:\s*([^;{]+?)\s*\{/g))
    for (const identifier of match[1].match(/[A-Za-z0-9_]+/g) ?? []) {
      if (shadowed.has(identifier)) continue;
      const name = renamed.get(identifier) ?? identifier;
      if (entities.has(name)) found.add(name);
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

  it('reads an entity out of a return type, through a union, an array and a renamed import', () => {
    const entities = new Set(['SupportIssue', 'UserData']);
    const source = `
      import { SupportIssue as Issue } from './support-issue.entity';
      import { UserData } from './user-data.entity';
      import { Something } from './elsewhere';

      class C {
        async one(id: number): Promise<Issue | null> { return null; }
        async many(): Promise<UserData[]> { return []; }
        async neither(): Promise<Something> { return null; }
      }`;

    // The renamed one is the case with no instance in this repository today, which is why it is
    // asserted here rather than left to the walk over the real controllers.
    expect(entitiesReturnedBy(source, entities)).toEqual(new Set(['SupportIssue', 'UserData']));
  });

  it('takes a name that is not an entity for nothing, renamed or not', () => {
    const entities = new Set(['SupportIssue']);
    const source = `
      import { Helper as SupportIssue } from './helper';

      class C {
        async one(): Promise<SupportIssue> { return null; }
      }`;

    // `SupportIssue` here is a local name for something else entirely. Reading the alias map in the
    // other direction would report the entity and put a relation in a closure it is not part of.
    expect(entitiesReturnedBy(source, entities)).toEqual(new Set());
  });

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
