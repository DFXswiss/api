/**
 * Standalone child-process helper for the M4 non-UTC-process-timezone check in
 * partner-statistic.integration.spec.ts.
 *
 * WHY a child process instead of `process.env.TZ = '...'` inside the test: Node/V8 resolves the
 * process-default timezone once per process and does not re-read `process.env.TZ` for later
 * `Date`/`Intl` calls in this repo's Jest setup (verified empirically — a `process.env.TZ`
 * mutation inside a `beforeAll` has no effect on `Date.prototype.getTimezoneOffset()` here, even
 * as the very first Date operation in the process). A genuinely different process timezone only
 * exists if the process is started with that `TZ` from the outset — hence this file is executed
 * via `ts-node` as a fresh child process with `TZ` set in its env, never `require`d directly.
 *
 * Not a `*.spec.ts` file on purpose: Jest's testRegex only matches `.spec.ts`, so this is never
 * picked up as a test itself — it is a one-shot script invoked by the real test via
 * `child_process.execFileSync`.
 */
import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryColumn, Repository } from 'typeorm';
// Same fixture default jest-env.setup.ts provides for Jest-run specs — this script runs outside
// Jest (a plain ts-node child process), so ConfigService's fail-loud boot check needs it too.
if (!process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD) {
  process.env.REALUNIT_W2W_GAS_LOW_BALANCE_THRESHOLD = '0.05';
}
import { ConfigService } from 'src/config/config';
import { PartnerStatisticGranularity } from '../partner-statistic.enum';
import { PartnerStatisticService } from '../partner-statistic.service';

@Entity({ name: 'user' })
class TzCheckUser {
  @PrimaryColumn() id: number;
  @Column() walletId: number;
  @Column({ type: 'timestamp' }) created: Date;
}

@Entity({ name: 'buy' })
class TzCheckBuy {
  @PrimaryColumn() id: number;
  @ManyToOne(() => TzCheckUser)
  @JoinColumn({ name: 'userId' })
  user: TzCheckUser;
}

@Entity({ name: 'buy_crypto' })
class TzCheckBuyCrypto {
  @PrimaryColumn() id: number;
  @ManyToOne(() => TzCheckBuy, { nullable: true })
  @JoinColumn({ name: 'buyId' })
  buy?: TzCheckBuy;
  @Column({ type: 'numeric', default: 0 }) amountInChf: number;
  @Column({ type: 'varchar', length: 64, nullable: true }) amlCheck?: string;
  @Column({ type: 'timestamp' }) created: Date;
}

async function main(): Promise<void> {
  const pgUrl = process.env.MIGRATION_TEST_PG;
  const schema = process.env.TZ_CHECK_SCHEMA;
  if (!pgUrl || !schema) throw new Error('MIGRATION_TEST_PG and TZ_CHECK_SCHEMA must both be set');

  new ConfigService();

  const dataSource = new DataSource({
    type: 'postgres',
    url: pgUrl,
    entities: [TzCheckUser, TzCheckBuy, TzCheckBuyCrypto],
    synchronize: false,
    schema,
    extra: { max: 1, options: '-c TimeZone=UTC' },
  });
  await dataSource.initialize();

  const buyCryptoRepo = dataSource.getRepository(TzCheckBuyCrypto) as unknown as Repository<TzCheckBuyCrypto>;
  const userRepo = dataSource.getRepository(TzCheckUser) as unknown as Repository<TzCheckUser>;
  // BUY-only check: buyFiatRepo/walletRepo are never touched by timelineByDirection(BUY, ...).
  const service = new PartnerStatisticService(buyCryptoRepo as any, {} as any, userRepo as any, {} as any);

  // Calls the REAL private method (same bracket-access pattern the existing specs use) so a
  // future edit to the trunc expression in partner-statistic.service.ts is actually exercised —
  // this is not a parallel/hand-copied SQL string.
  const map: Map<string, unknown> = await (service as any).timelineByDirection(
    1,
    new Date('2024-06-10T00:00:00.000Z'),
    new Date('2024-06-12T00:00:00.000Z'),
    'Buy',
    PartnerStatisticGranularity.DAY,
  );

  await dataSource.destroy();

  // Only the bucket KEYS are the signal here (derived from the DATE_TRUNC(...) result). Some
  // transitively-imported modules (SDK clients pulled in by production code) log their own
  // "Logging enabled" lines to stdout on import, so the result is marked with a distinctive
  // prefix — the parent process extracts exactly that line rather than parsing all of stdout.
  process.stdout.write(`TZ_CHECK_RESULT:${JSON.stringify([...map.keys()].sort())}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
