import { Util } from 'src/shared/utils/util';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { LedgerDtoMapper, SuspenseLegRow } from 'src/subdomains/core/accounting/dto/ledger-dto.mapper';
import { SuspenseLegDto } from 'src/subdomains/core/accounting/dto/ledger-reconciliation.dto';
import { AccountType, LedgerAccount } from 'src/subdomains/core/accounting/entities/ledger-account.entity';
import { LedgerLeg } from 'src/subdomains/core/accounting/entities/ledger-leg.entity';
import { LedgerTx } from 'src/subdomains/core/accounting/entities/ledger-tx.entity';
import {
  SUSPENSE_LEG_PROJECTION,
  SUSPENSE_LEG_RESPONSE_FIELDS,
  LedgerLegRepository,
} from 'src/subdomains/core/accounting/repositories/ledger-leg.repository';
import { DataSource } from 'typeorm';

const SCHEMA = 'ledger_suspense_projection_spec';

/**
 * `GET /dashboard/accounting/ledger/suspense` — the four levels from
 * `docs/read-path-projections.md`.
 *
 * The response is four values and a currency, drawn from the leg, its transaction and its account.
 */
describeProjection('ledger suspense — read-path projection', () => {
  let dataSource: DataSource;
  let legs: LedgerLegRepository;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
    legs = new LedgerLegRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  // This endpoint takes no parameter — it answers with every leg on a suspense account. Rows left
  // behind by an earlier test would therefore show up in the next one, and level 3 would compare a
  // baseline that already contains a deliberately incomplete row.
  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE "${SCHEMA}"."ledger_leg", "${SCHEMA}"."ledger_tx", "${SCHEMA}"."ledger_account" RESTART IDENTITY CASCADE`,
    );
  });

  /**
   * One leg on an account of the given type.
   *
   * `type` is set explicitly: it is a TypeScript enum in a text column and the query filters on it,
   * so a generated value would make the endpoint answer with nothing for a reason that has nothing
   * to do with the projection.
   */
  async function seedLeg(
    type = AccountType.SUSPENSE,
    values: Partial<LedgerLeg> = {},
  ): Promise<{ leg: LedgerLeg; tx: LedgerTx; account: LedgerAccount }> {
    const account = await seedEntity<LedgerAccount>(dataSource, LedgerAccount, { values: { type } });
    // `amountChfSum` carries a check constraint pinning it to 0 — the single-row balance gate. The
    // generated value would be distinct and therefore non-zero, and the insert would be rejected.
    const tx = await seedEntity<LedgerTx>(dataSource, LedgerTx, { values: { amountChfSum: 0 } });
    const leg = await seedEntity<LedgerLeg>(dataSource, LedgerLeg, { values: { tx, account, ...values } });
    return { leg, tx, account };
  }

  /**
   * The response the endpoint produces, through the projected query.
   *
   * `now` is a parameter because the age is derived from it: a comparison that takes its own
   * timestamp disagrees with this one across a day boundary, which would fail for the calendar
   * rather than for the projection.
   */
  async function suspenseOf(
    fields = SUSPENSE_LEG_PROJECTION.fields,
    now = new Date(),
  ): Promise<{ totalChf: number; legs: SuspenseLegDto[] }> {
    const rows = await legs.findSuspenseLegs(fields);
    const totalChf = Util.round(Util.sum(rows.map((l) => l.amountChf ?? 0)), 2);
    const mapped: SuspenseLegRow[] = rows.map((leg) => ({
      leg,
      bookingDate: leg.tx.bookingDate,
      age: Util.daysDiff(leg.tx.bookingDate, now),
    }));

    return { totalChf, legs: mapped.map((row) => LedgerDtoMapper.mapSuspenseLeg(row)) };
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — a suspense leg answers with no empty field', async () => {
    await seedLeg();

    const response = await suspenseOf();

    expect(response.legs).toHaveLength(1);
    expectNoEmptyFields(response);
  }, 120000);

  // --- LEVEL 2: variants --- //

  it('level 2 — only legs on suspense accounts are listed', async () => {
    const suspense = await seedLeg(AccountType.SUSPENSE);
    await seedLeg(AccountType.INCOME);

    const response = await suspenseOf();

    expect(response.legs.map((row) => row.legId)).toEqual([suspense.leg.id]);
  }, 120000);

  it('level 2 — legs are ordered by booking date, oldest first', async () => {
    const older = await seedLeg();
    const newer = await seedLeg();
    await dataSource.getRepository(LedgerTx).update(older.tx.id, { bookingDate: new Date('2020-01-01T00:00:00.000Z') });
    await dataSource.getRepository(LedgerTx).update(newer.tx.id, { bookingDate: new Date('2026-01-01T00:00:00.000Z') });

    // The sort column lives on the joined transaction; with the join reduced to a bare id the
    // statement would still run and the order would silently be the storage order.
    const response = await suspenseOf();

    expect(response.legs.map((row) => row.legId)).toEqual([older.leg.id, newer.leg.id]);
  }, 120000);

  it('level 2 — a leg without a CHF amount contributes nothing to the total', async () => {
    await seedLeg(AccountType.SUSPENSE, { amountChf: null });
    const withAmount = await seedLeg(AccountType.SUSPENSE, { amountChf: 25 });

    const response = await suspenseOf();

    // `amountChf` is nullable and the sum reads it with a fallback. A projection that dropped the
    // column would produce the same total as a row that genuinely has none — which is why level 3
    // covers it against a fixture where the value is set.
    expect(response.totalChf).toEqual(25);
    expect(response.legs.find((row) => row.legId === withAmount.leg.id)?.amountChf).toEqual(25);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  it('level 3 — every field feeding the suspense response is required', async () => {
    await seedLeg(AccountType.SUSPENSE, { amountChf: 42 });

    await expectEveryFieldRequired(SUSPENSE_LEG_RESPONSE_FIELDS, (omitted) =>
      suspenseOf(projectionFieldsWithout(SUSPENSE_LEG_PROJECTION.fields, omitted)),
    );
  }, 300000);

  // --- LEVEL 4: consistency against a second source --- //

  it('level 4 — the projected response equals the one from a full load', async () => {
    await seedLeg();
    const now = new Date();

    const projected = await suspenseOf(SUSPENSE_LEG_PROJECTION.fields, now);
    // The unprojected load is the second source: the same rows selected without a field list.
    const full = await dataSource
      .getRepository(LedgerLeg)
      .createQueryBuilder('leg')
      .innerJoinAndSelect('leg.tx', 'tx')
      .innerJoinAndSelect('leg.account', 'account')
      .where('account.type = :type', { type: AccountType.SUSPENSE })
      .orderBy('tx.bookingDate', 'ASC')
      .getMany();

    // The whole response, not just the rows: the total is derived from a column the projection has
    // to carry, so comparing only the legs would leave it unchecked.
    expect(projected).toEqual({
      totalChf: Util.round(Util.sum(full.map((leg) => leg.amountChf ?? 0)), 2),
      legs: full.map((leg) =>
        LedgerDtoMapper.mapSuspenseLeg({
          leg,
          bookingDate: leg.tx.bookingDate,
          age: Util.daysDiff(leg.tx.bookingDate, now),
        }),
      ),
    });
  }, 120000);
});
