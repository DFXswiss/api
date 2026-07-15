import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Brackets } from 'typeorm';
import { createCustomBankTx } from '../../__mocks__/bank-tx.entity.mock';
import { BankTxIndicator } from '../../entities/bank-tx.entity';
import { BankTxRepository } from '../../repositories/bank-tx.repository';
import { BankTxOutgoingMatchService, OutgoingBankTxMatch } from '../bank-tx-outgoing-match.service';

describe('BankTxOutgoingMatchService.getUniqueOutgoingBankTx', () => {
  let service: BankTxOutgoingMatchService;
  let bankTxRepo: jest.Mocked<BankTxRepository>;
  let query: Record<string, jest.Mock>;

  const completeMatch: OutgoingBankTxMatch = {
    remittanceInfo: ' DFX-FO-42 Synthetic payout ',
    endToEndId: ' E2E-42 ',
    accountIban: ' li00 synthetic account ',
    amount: 12.34,
    currency: ' eur ',
    earliestDate: new Date('2026-07-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    query = {
      select: jest.fn(),
      leftJoinAndSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    for (const method of ['select', 'leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'take']) {
      query[method].mockReturnValue(query);
    }
    bankTxRepo = createMock<BankTxRepository>();
    bankTxRepo.createQueryBuilder.mockReturnValue(query as never);

    const module: TestingModule = await Test.createTestingModule({ providers: [BankTxOutgoingMatchService] })
      .useMocker((token) => (token === BankTxRepository ? bankTxRepo : createMock()))
      .compile();
    service = module.get(BankTxOutgoingMatchService);
  });

  it.each([
    ['a stable reference', { ...completeMatch, remittanceInfo: undefined, endToEndId: undefined }],
    ['the source account', { ...completeMatch, accountIban: undefined }],
    ['the currency', { ...completeMatch, currency: undefined }],
    ['a finite amount', { ...completeMatch, amount: Number.NaN }],
    ['a positive amount', { ...completeMatch, amount: 0 }],
    ['a readiness date', { ...completeMatch, earliestDate: undefined }],
    ['a valid readiness date', { ...completeMatch, earliestDate: new Date('invalid') }],
  ])('returns no match when the payout lacks %s', async (_description, match) => {
    await expect(service.getUniqueOutgoingBankTx(match as OutgoingBankTxMatch)).resolves.toBeUndefined();
    expect(bankTxRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('constrains matches to debit, account, currency, amount, readiness date and either reference', async () => {
    const bankTx = createCustomBankTx({ id: 42 });
    query.getMany.mockResolvedValue([bankTx]);

    await expect(service.getUniqueOutgoingBankTx(completeMatch)).resolves.toBe(bankTx);

    expect(query.where).toHaveBeenCalledWith('bankTx.creditDebitIndicator = :indicator', {
      indicator: BankTxIndicator.DEBIT,
    });
    expect(query.andWhere).toHaveBeenCalledWith(`UPPER(REPLACE(bankTx.accountIban, ' ', '')) = :accountIban`, {
      accountIban: 'LI00SYNTHETICACCOUNT',
    });
    expect(query.andWhere).toHaveBeenCalledWith('UPPER(bankTx.currency) = :currency', { currency: 'EUR' });
    expect(query.andWhere).toHaveBeenCalledWith(
      'ABS((bankTx.amount - COALESCE(bankTx.chargeAmount, 0)) - :amount) < :amountTolerance',
      { amount: 12.34, amountTolerance: 0.005 },
    );
    expect(query.andWhere).toHaveBeenCalledWith('bankTx.created >= :earliestDate', {
      earliestDate: completeMatch.earliestDate,
    });
    expect(query.take).toHaveBeenCalledWith(2);

    const referenceBrackets = query.andWhere.mock.calls
      .map(([condition]) => condition)
      .find((value) => value instanceof Brackets);
    const references = { where: jest.fn(), orWhere: jest.fn() };
    referenceBrackets.whereFactory(references as never);
    expect(references.where).toHaveBeenCalledWith(`REPLACE(bankTx.remittanceInfo, ' ', '') = :remittanceInfo`, {
      remittanceInfo: 'DFX-FO-42Syntheticpayout',
    });
    expect(references.orWhere).toHaveBeenCalledWith('bankTx.endToEndId = :endToEndId', { endToEndId: 'E2E-42' });
  });

  it('matches a charged Bank Frick debit (Amt=1005.00, Chrgs=5.00) against a fiat_output.amount of 1000.00', async () => {
    // The literal #8 regression case: a booked debit entry included a 5.00 bank charge, so
    // bank_tx.amount is the gross 1005.00 and bank_tx.chargeAmount holds the real, parsed charge - the
    // query must ask Postgres to compare net-of-charge, not the full booked amount, against the
    // customer-facing fiat_output.amount.
    const chargedBankTx = createCustomBankTx({ id: 99, amount: 1005, chargeAmount: 5 });
    query.getMany.mockResolvedValue([chargedBankTx]);

    await expect(service.getUniqueOutgoingBankTx({ ...completeMatch, amount: 1000 })).resolves.toBe(chargedBankTx);

    expect(query.andWhere).toHaveBeenCalledWith(
      'ABS((bankTx.amount - COALESCE(bankTx.chargeAmount, 0)) - :amount) < :amountTolerance',
      { amount: 1000, amountTolerance: 0.005 },
    );
  });

  it('still matches a charge-less bank_tx (chargeAmount=0) unchanged', async () => {
    const chargeLessBankTx = createCustomBankTx({ id: 100, amount: 1000, chargeAmount: 0 });
    query.getMany.mockResolvedValue([chargeLessBankTx]);

    await expect(service.getUniqueOutgoingBankTx({ ...completeMatch, amount: 1000 })).resolves.toBe(chargeLessBankTx);
  });

  it.each([
    [{ ...completeMatch, endToEndId: undefined }, `REPLACE(bankTx.remittanceInfo, ' ', '') = :remittanceInfo`],
    [{ ...completeMatch, remittanceInfo: undefined }, 'bankTx.endToEndId = :endToEndId'],
  ])('supports a single correlation key without weakening the other constraints', async (match, expectedWhere) => {
    await service.getUniqueOutgoingBankTx(match);

    const referenceBrackets = query.andWhere.mock.calls
      .map(([condition]) => condition)
      .find((value) => value instanceof Brackets);
    const references = { where: jest.fn(), orWhere: jest.fn() };
    referenceBrackets.whereFactory(references as never);
    expect(references.where).toHaveBeenCalledWith(expectedWhere, expect.any(Object));
    expect(references.orWhere).not.toHaveBeenCalled();
  });

  it('returns undefined for no match and rejects ambiguous matches', async () => {
    await expect(service.getUniqueOutgoingBankTx(completeMatch)).resolves.toBeUndefined();

    query.getMany.mockResolvedValue([createCustomBankTx({ id: 1 }), createCustomBankTx({ id: 2 })]);
    await expect(service.getUniqueOutgoingBankTx(completeMatch)).rejects.toThrow(
      'Ambiguous outgoing bank transaction match',
    );
  });
});
