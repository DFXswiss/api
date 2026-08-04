import { createMock } from '@golevelup/ts-jest';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { TransactionUtilService } from 'src/subdomains/core/transaction/transaction-util.service';
import { FiatOutput, FiatOutputType } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';
import { FiatOutputRepository } from 'src/subdomains/supporting/fiat-output/fiat-output.repository';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { DataSource, IsNull } from 'typeorm';
import { BankTxReturn } from '../bank-tx-return.entity';
import { BankTxReturnRepository } from '../bank-tx-return.repository';
import { BankTxReturnService } from '../bank-tx-return.service';

const SCHEMA = 'bank_tx_return_refund_claim_spec';

/**
 * The compare-and-swap in `BankTxReturnService.refundBankTx`, against a real database.
 *
 * The unit specs stub the transaction manager (`update` resolves `{ affected: 1 }`) and mock
 * `FiatOutputService`, so neither the inverse-side foreign key write nor the claim's WHERE ever
 * executes. They can pin the call order, which is a proxy; they cannot pin the invariant the order
 * exists for. #4656 shipped because the proxy was asserted the wrong way round and still passed.
 *
 * Here the real services run over real rows, so the claim is evaluated by Postgres.
 */
describeProjection('bank-tx-return refund claim — postgres semantics', () => {
  let dataSource: DataSource;

  const creditorData = {
    name: 'Max Mustermann',
    address: 'Hauptstrasse',
    houseNumber: '42',
    zip: '3000',
    city: 'Bern',
    country: 'CH',
  };

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
  });

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  function buildFiatOutputService(): FiatOutputService {
    // Only the repository is reached for BANK_TX_RETURN with explicit creditor data — the BUY_FIAT
    // branch that uses the others is not taken. The repository has to be real: it is `save()` that
    // emits the inverse-side `UPDATE bank_tx_return SET chargebackOutputId`, which is the whole
    // mechanism under test.
    return new FiatOutputService(
      dataSource.getRepository(FiatOutput) as unknown as FiatOutputRepository,
      createMock(),
      createMock(),
      createMock(),
      createMock(),
      createMock(),
      createMock(),
      createMock(),
      createMock(),
    );
  }

  function buildService(fiatOutputService = buildFiatOutputService()): BankTxReturnService {
    const transactionUtilService = createMock<TransactionUtilService>();
    transactionUtilService.validateChargebackIban.mockResolvedValue(true);

    return new BankTxReturnService(
      dataSource.getRepository(BankTxReturn) as unknown as BankTxReturnRepository,
      createMock<TransactionService>(),
      transactionUtilService,
      fiatOutputService,
      createMock<PricingService>(),
      createMock<FiatService>(),
    );
  }

  /** A return the cron would select: user leg done, approval pending. */
  async function seedRequestedReturn(): Promise<BankTxReturn> {
    return seedEntity(dataSource, BankTxReturn, {
      values: {
        chargebackIban: 'CH9300762011623852957',
        chargebackAmount: 50,
        chargebackAsset: 'CHF',
        inputAsset: 'CHF',
        chargebackCreditorData: JSON.stringify(creditorData),
        chargebackAllowedDateUser: new Date('2026-08-01T10:00:00.000Z'),
        chargebackAllowedDate: null,
        chargebackDate: null,
        chargebackOutput: null,
        chargebackBankTx: null,
      },
      relations: { bankTx: { values: { amount: 52, chargeAmount: 0, iban: 'CH0000000000000000000' } } },
    });
  }

  // bankTx is what validateRefund reads the refund cap from, and chargebackOutput is what it and the
  // claim both key on — the production callers load both.
  async function reload(id: number): Promise<BankTxReturn> {
    return dataSource
      .getRepository(BankTxReturn)
      .findOne({ where: { id }, relations: { chargebackOutput: true, bankTx: true } });
  }

  it('claims the row and writes chargebackOutputId in the same transaction', async () => {
    const seeded = await seedRequestedReturn();
    const entity = await reload(seeded.id);

    await buildService().refundBankTx(entity, {
      chargebackAllowedDate: new Date(),
      chargebackAllowedBy: 'API',
    });

    const stored = await reload(seeded.id);
    expect(stored.chargebackAllowedDate).not.toBeNull();
    // The FK is never named in the claim's SET; it can only be here because saving the FiatOutput
    // wrote it through the inverse side. Dropping `{ bankTxReturn }` from the createInternal call
    // leaves the output orphaned and this null, which no mocked spec can observe.
    expect(stored.chargebackOutput).not.toBeNull();
    expect(stored.chargebackOutput.type).toBe(FiatOutputType.BANK_TX_RETURN);
    expect(stored.chargebackOutput.originEntityId).toBe(seeded.id);
  });

  it('matches no row when the output is written before the claim', async () => {
    const seeded = await seedRequestedReturn();
    const entity = await reload(seeded.id);
    const fiatOutputService = buildFiatOutputService();

    // The pre-#4656 ordering, reproduced against the real database: create the output first, so its
    // inverse-side save sets chargebackOutputId, then run the claim the service would run. The
    // claim pins that column to IsNull(), so it now conflicts with its own transaction's write.
    const affected = await dataSource.manager.transaction(async (manager) => {
      await fiatOutputService.createInternal(
        FiatOutputType.BANK_TX_RETURN,
        { bankTxReturn: entity },
        entity.id,
        false,
        { iban: entity.chargebackIban, amount: entity.chargebackAmount, currency: 'CHF', ...creditorData },
        manager,
      );

      const claim = await manager.update(
        BankTxReturn,
        {
          id: entity.id,
          chargebackOutput: IsNull(),
          chargebackAllowedDate: IsNull(),
          chargebackAllowedDateUser: entity.chargebackAllowedDateUser,
          chargebackDate: IsNull(),
          chargebackBankTx: IsNull(),
        },
        { chargebackAllowedBy: 'API' },
      );

      return claim.affected;
    });

    expect(affected).toBe(0);
  });

  it('lets only one of two overlapping refunds claim the same return', async () => {
    const seeded = await seedRequestedReturn();
    const [first, second] = await Promise.all([reload(seeded.id), reload(seeded.id)]);

    // Both read the row before either writes, which is the cron-versus-admin window: without the
    // claim both pass validateRefund and each mints a FiatOutput, and only one can own the FK.
    const results = await Promise.allSettled([
      buildService().refundBankTx(first, { chargebackAllowedDate: new Date(), chargebackAllowedBy: 'API' }),
      buildService().refundBankTx(second, { chargebackAllowedDate: new Date(), chargebackAllowedBy: 'Compliance' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const outputs = await dataSource
      .getRepository(FiatOutput)
      .find({ where: { type: FiatOutputType.BANK_TX_RETURN, originEntityId: seeded.id } });
    expect(outputs).toHaveLength(1);
  });
});
