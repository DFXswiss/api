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

describe('BankTxOutgoingMatchService.getUniqueExternalChargebackBankTx', () => {
  let service: BankTxOutgoingMatchService;
  let bankTxRepo: jest.Mocked<BankTxRepository>;
  let query: Record<string, jest.Mock>;

  const completeMatch = {
    counterpartyIban: ' de12 5001 0517 0648 4898 90 ',
    accountIban: ' lu11 6060 0020 0000 5040 ',
    amount: 83.39,
    currency: ' eur ',
    earliestDate: new Date('2026-07-22T00:00:00.000Z'),
  };

  beforeEach(async () => {
    query = {
      select: jest.fn(),
      leftJoinAndSelect: jest.fn(),
      leftJoin: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    for (const method of ['select', 'leftJoinAndSelect', 'leftJoin', 'where', 'andWhere', 'orderBy', 'take']) {
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
    ['the counterparty IBAN', { ...completeMatch, counterpartyIban: undefined }],
    ['the source account', { ...completeMatch, accountIban: undefined }],
    ['the currency', { ...completeMatch, currency: undefined }],
    ['a finite amount', { ...completeMatch, amount: Number.NaN }],
    ['a positive amount', { ...completeMatch, amount: 0 }],
    ['an earliest date', { ...completeMatch, earliestDate: undefined }],
    ['a valid earliest date', { ...completeMatch, earliestDate: new Date('invalid') }],
  ])('returns no match when the refund profile lacks %s', async (_description, match) => {
    await expect(service.getUniqueExternalChargebackBankTx(match as never)).resolves.toBeUndefined();
    expect(bankTxRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  function bracketCalls(brackets: Brackets): { where: jest.Mock; orWhere: jest.Mock } {
    const spy = { where: jest.fn(), orWhere: jest.fn() };
    spy.where.mockReturnValue(spy);
    spy.orWhere.mockReturnValue(spy);
    brackets.whereFactory(spy as never);
    return spy;
  }

  it('constrains matches to unassigned, matured debits on counterparty, account, currency, net amount and date', async () => {
    const bankTx = createCustomBankTx({ id: 208278, iban: 'DE12500105170648489890' });
    query.getMany.mockResolvedValue([bankTx]);

    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBe(bankTx);

    expect(query.where).toHaveBeenCalledWith('bankTx.creditDebitIndicator = :indicator', {
      indicator: BankTxIndicator.DEBIT,
    });
    expect(query.andWhere).toHaveBeenCalledWith(`UPPER(REPLACE(bankTx.accountIban, ' ', '')) = :accountIban`, {
      accountIban: 'LU116060002000005040',
    });
    expect(query.andWhere).toHaveBeenCalledWith('UPPER(bankTx.currency) = :currency', { currency: 'EUR' });
    expect(query.andWhere).toHaveBeenCalledWith(
      'ABS((bankTx.amount - COALESCE(bankTx.chargeAmount, 0)) - :amount) < :amountTolerance',
      { amount: 83.39, amountTolerance: 0.005 },
    );
    expect(query.andWhere).toHaveBeenCalledWith('bankTx.created >= :earliestDate', {
      earliestDate: completeMatch.earliestDate,
    });
    // in-flight DBITs of our own fiat_output payments must have been claimable by the fiat-output
    // matcher first
    expect(query.andWhere).toHaveBeenCalledWith('bankTx.created <= :maturedDate', {
      maturedDate: expect.any(Date),
    });
    // bank TXs already linked as chargeback of a buy-crypto or belonging to a fiat_output payment
    // (linked, same remittance text or same end-to-end ID) are excluded
    expect(query.leftJoin).toHaveBeenCalledWith(
      expect.anything(),
      'chargebackOf',
      'chargebackOf.chargebackBankTxId = bankTx.id',
    );
    expect(query.leftJoin).toHaveBeenCalledWith(
      expect.anything(),
      'linkedFiatOutput',
      'linkedFiatOutput.bankTxId = bankTx.id',
    );
    expect(query.leftJoin).toHaveBeenCalledWith(
      expect.anything(),
      'remittanceFiatOutput',
      `REPLACE(remittanceFiatOutput.remittanceInfo, ' ', '') = REPLACE(bankTx.remittanceInfo, ' ', '')`,
    );
    expect(query.leftJoin).toHaveBeenCalledWith(
      expect.anything(),
      'frickReferenceFiatOutput',
      `REPLACE(frickReferenceFiatOutput.frickReference, ' ', '') = REPLACE(bankTx.remittanceInfo, ' ', '')`,
    );
    expect(query.leftJoin).toHaveBeenCalledWith(
      expect.anything(),
      'endToEndFiatOutput',
      'endToEndFiatOutput.endToEndId = bankTx.endToEndId',
    );
    expect(query.andWhere).toHaveBeenCalledWith('chargebackOf.id IS NULL');
    expect(query.andWhere).toHaveBeenCalledWith('linkedFiatOutput.id IS NULL');
    expect(query.andWhere).toHaveBeenCalledWith('remittanceFiatOutput.id IS NULL');
    expect(query.andWhere).toHaveBeenCalledWith('frickReferenceFiatOutput.id IS NULL');
    expect(query.andWhere).toHaveBeenCalledWith('endToEndFiatOutput.id IS NULL');
    expect(query.take).toHaveBeenCalledWith(5);

    const brackets = query.andWhere.mock.calls.map(([condition]) => condition).filter((v) => v instanceof Brackets);
    expect(brackets).toHaveLength(2);
    const [type, iban] = brackets.map(bracketCalls);
    expect(type.where).toHaveBeenCalledWith('bankTx.type IS NULL');
    expect(type.orWhere).toHaveBeenCalledWith('bankTx.type IN (:...unassignedTypes)', expect.any(Object));
    expect(iban.where).toHaveBeenCalledWith(`UPPER(REPLACE(bankTx.iban, ' ', '')) = :counterpartyIban`, {
      counterpartyIban: 'DE12500105170648489890',
    });
    expect(iban.orWhere).toHaveBeenCalledWith('bankTx.iban IS NULL');
  });

  it('matches an IBAN-less DBIT only when the remittance text quotes the refunded amount', async () => {
    const externalRefund = createCustomBankTx({
      id: 208278,
      remittanceInfo: 'Montant initial : 83,39, Montant retourne : 83,39, Charges : 0',
    });
    query.getMany.mockResolvedValue([externalRefund]);
    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBe(externalRefund);

    // a bank-fee DBIT (also IBAN-less) with a coincidentally equal amount quotes no amount
    query.getMany.mockResolvedValue([
      createCustomBankTx({ id: 208943, remittanceInfo: 'Facture intermediaire du 04/08/2026' }),
    ]);
    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBeUndefined();

    // no remittance at all
    query.getMany.mockResolvedValue([createCustomBankTx({ id: 188959 })]);
    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBeUndefined();
  });

  it('quotes integer and dot-decimal amounts, delimited by non-digits', async () => {
    const integerRefund = createCustomBankTx({
      id: 190663,
      remittanceInfo: 'Montant initial : 500, Montant retourne : 500, Charges : 0',
    });
    query.getMany.mockResolvedValue([integerRefund]);
    await expect(service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 500 })).resolves.toBe(
      integerRefund,
    );

    // '1500' must not count as '500', '83,391' not as '83,39'
    query.getMany.mockResolvedValue([createCustomBankTx({ id: 2, remittanceInfo: 'Montant initial : 1500' })]);
    await expect(service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 500 })).resolves.toBeUndefined();
    query.getMany.mockResolvedValue([createCustomBankTx({ id: 3, remittanceInfo: 'Ref 83,391' })]);
    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBeUndefined();

    const dotRefund = createCustomBankTx({ id: 4, remittanceInfo: 'Refund of 83.39 EUR' });
    query.getMany.mockResolvedValue([dotRefund]);
    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBe(dotRefund);
  });

  it('never treats date tokens or thousand-grouping tails as an amount quote', async () => {
    // a year-valued amount must not match the year inside a fee DBIT's date
    query.getMany.mockResolvedValue([
      createCustomBankTx({ id: 7, remittanceInfo: 'Facture intermediaire du 04/08/2026' }),
    ]);
    await expect(
      service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 2026 }),
    ).resolves.toBeUndefined();
    query.getMany.mockResolvedValue([
      createCustomBankTx({ id: 8, remittanceInfo: 'Periode : du 01/07/2026 au 31/07/2026' }),
    ]);
    await expect(
      service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 2026 }),
    ).resolves.toBeUndefined();

    // an integer prefix of another number is no quote: '500,50' must not quote 500, '83,39' not 83
    query.getMany.mockResolvedValue([createCustomBankTx({ id: 13, remittanceInfo: 'Facture 500,50' })]);
    await expect(service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 500 })).resolves.toBeUndefined();
    query.getMany.mockResolvedValue([createCustomBankTx({ id: 14, remittanceInfo: 'Montant initial : 83,39' })]);
    await expect(service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 83 })).resolves.toBeUndefined();

    // dot dates must not quote 'dd.mm', dash dates must not quote the year
    query.getMany.mockResolvedValue([createCustomBankTx({ id: 10, remittanceInfo: 'Rechnung vom 15.08.2026' })]);
    await expect(
      service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 15.08 }),
    ).resolves.toBeUndefined();
    query.getMany.mockResolvedValue([createCustomBankTx({ id: 11, remittanceInfo: 'Facture du 4.8.2026' })]);
    await expect(service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 4.8 })).resolves.toBeUndefined();
    query.getMany.mockResolvedValue([createCustomBankTx({ id: 12, remittanceInfo: 'Valuta 2026-08-04' })]);
    await expect(
      service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 2026 }),
    ).resolves.toBeUndefined();

    // Swiss thousand grouping: "1'234,56" must not quote 234.56
    query.getMany.mockResolvedValue([createCustomBankTx({ id: 9, remittanceInfo: "Betrag 1'234,56" })]);
    await expect(
      service.getUniqueExternalChargebackBankTx({ ...completeMatch, amount: 234.56 }),
    ).resolves.toBeUndefined();
  });

  it('treats a full result page as ambiguous (rows beyond the cap may exist)', async () => {
    query.getMany.mockResolvedValue(
      [11, 12, 13, 14, 15].map((id) => createCustomBankTx({ id, iban: 'DE12500105170648489890' })),
    );

    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBeUndefined();
  });

  it('returns undefined for no match and for ambiguous matches instead of guessing', async () => {
    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBeUndefined();

    query.getMany.mockResolvedValue([
      createCustomBankTx({ id: 1, iban: 'DE12500105170648489890' }),
      createCustomBankTx({ id: 2, iban: 'DE12500105170648489890' }),
    ]);
    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBeUndefined();
  });

  it('keeps an implausible IBAN-less candidate from blocking the unique plausible one', async () => {
    const ibanMatch = createCustomBankTx({ id: 5, iban: 'DE12500105170648489890' });
    query.getMany.mockResolvedValue([
      ibanMatch,
      createCustomBankTx({ id: 6, remittanceInfo: 'Facture intermediaire du 04/08/2026' }),
    ]);

    await expect(service.getUniqueExternalChargebackBankTx(completeMatch)).resolves.toBe(ibanMatch);
  });
});
