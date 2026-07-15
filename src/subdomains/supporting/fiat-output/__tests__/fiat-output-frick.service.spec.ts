import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import {
  FrickPaymentCharge,
  FrickPaymentOrderNotFoundError,
  FrickPaymentState,
  FrickPaymentType,
} from 'src/integration/bank/dto/frick.dto';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import { IbanService } from 'src/integration/bank/services/iban.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { IsNull } from 'typeorm';
import { createCustomBank } from '../../bank/bank/__mocks__/bank.entity.mock';
import { IbanBankName } from '../../bank/bank/dto/bank.dto';
import { createCustomFiatOutput } from '../__mocks__/fiat-output.entity.mock';
import { FiatOutputFrickService } from '../fiat-output-frick.service';
import { FiatOutputRepository } from '../fiat-output.repository';
import { TransactionCharge } from '../fiat-output.entity';

describe('FiatOutputFrickService', () => {
  let service: FiatOutputFrickService;

  let fiatOutputRepo: FiatOutputRepository;
  let frickService: BankFrickService;
  let ibanService: IbanService;

  const order = {
    orderId: 4242,
    customId: 'DFX-FO-42',
    type: FrickPaymentType.SEPA,
    state: FrickPaymentState.PREPARED,
    amount: 10,
    currency: 'EUR',
    reference: 'Synthetic payout',
    debitor: { iban: 'SYNTHETIC-DEBTOR' },
    creditor: { name: 'Synthetic Recipient', iban: 'SYNTHETIC-CREDITOR' },
  };

  beforeEach(async () => {
    fiatOutputRepo = createMock<FiatOutputRepository>();
    frickService = createMock<BankFrickService>();
    ibanService = createMock<IbanService>();
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
    // Default: the atomic reservation update always "succeeds" (affected: 1), matching a real,
    // uncontended TypeORM update. Tests exercising the reservation race override this per-call.
    jest.spyOn(fiatOutputRepo, 'update').mockResolvedValue({ affected: 1, raw: {}, generatedMaps: [] });

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatOutputFrickService,
        { provide: FiatOutputRepository, useValue: fiatOutputRepo },
        { provide: BankFrickService, useValue: frickService },
        { provide: IbanService, useValue: ibanService },

        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<FiatOutputFrickService>(FiatOutputFrickService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('keeps transmission disabled unless the explicit payout flag is true', async () => {
    Config.bank.frick.payoutEnabled = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);

    await service.transmitPayments();

    expect(fiatOutputRepo.find).not.toHaveBeenCalled();
    expect(frickService.createPaymentOrder).not.toHaveBeenCalled();
  });

  it('honors the dedicated DisabledProcess kill-switch even when payout configuration is enabled', async () => {
    Config.bank.frick.payoutEnabled = true;
    jest
      .spyOn(processServiceModule, 'DisabledProcess')
      .mockImplementation((process) => process === processServiceModule.Process.FIAT_OUTPUT_FRICK_TRANSMISSION);
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);

    await service.transmitPayments();

    expect(fiatOutputRepo.find).not.toHaveBeenCalled();
    expect(frickService.createPaymentOrder).not.toHaveBeenCalled();
  });

  it('does not create payouts while the signed Bank Frick client is unavailable', async () => {
    Config.bank.frick.payoutEnabled = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(false);

    await service.transmitPayments();

    expect(service.canCreatePayments()).toBe(false);
    expect(fiatOutputRepo.find).not.toHaveBeenCalled();
  });

  it('honors the dedicated status-check kill-switch', async () => {
    jest
      .spyOn(processServiceModule, 'DisabledProcess')
      .mockImplementation((process) => process === processServiceModule.Process.FIAT_OUTPUT_FRICK_STATUS_CHECK);

    await service.checkFrickOrderStatus();

    expect(frickService.isAvailable).not.toHaveBeenCalled();
    expect(fiatOutputRepo.find).not.toHaveBeenCalled();
    expect(frickService.approvePaymentWithoutTan).not.toHaveBeenCalled();
  });

  it('skips status polling while Bank Frick is unavailable', async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(false);

    await service.checkFrickOrderStatus();

    expect(fiatOutputRepo.find).not.toHaveBeenCalled();
    expect(frickService.getPaymentOrder).not.toHaveBeenCalled();
  });

  it('uses a stable customId and persists it before any optional approval', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue(order);
    jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue('4242');
    jest
      .spyOn(frickService, 'approvePaymentWithoutTan')
      .mockResolvedValue({ ...order, state: FrickPaymentState.IN_PROGRESS });
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        amount: 10,
        currency: 'EUR',
        isInstant: false,
        accountIban: 'SYNTHETIC-DEBTOR',
        name: 'Synthetic Recipient',
        iban: 'SYNTHETIC-CREDITOR',
        remittanceInfo: 'Synthetic payout',
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    expect(frickService.createPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({ customId: 'DFX-FO-42', reference: 'DFX-FO-42 Synthetic payout' }),
    );
    // Reserved atomically, before the Bank Frick call itself. frickReference is folded into this same
    // write (not deferred to the post-createPaymentOrder update below) so it can never be stranded by a
    // crash between the two writes.
    expect(fiatOutputRepo.update).toHaveBeenNthCalledWith(
      1,
      { id: 42, frickCustomId: IsNull() },
      { frickCustomId: 'DFX-FO-42', frickReference: 'DFX-FO-42 Synthetic payout' },
    );
    expect((fiatOutputRepo.update as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (frickService.createPaymentOrder as jest.Mock).mock.invocationCallOrder[0],
    );
    // remittanceInfo already had a value ('Synthetic payout') and must stay untouched - the bank-bound
    // reference goes into frickReference instead, which is already durably set by the reserve above and
    // must NOT be repeated/overwritten here.
    expect(fiatOutputRepo.update).toHaveBeenNthCalledWith(
      2,
      42,
      expect.objectContaining({
        frickOrderId: '4242',
        isTransmittedDate: expect.any(Date),
      }),
    );
    expect((fiatOutputRepo.update as jest.Mock).mock.calls[1][1]).not.toHaveProperty('remittanceInfo');
    expect((fiatOutputRepo.update as jest.Mock).mock.calls[1][1]).not.toHaveProperty('frickReference');
    expect((fiatOutputRepo.update as jest.Mock).mock.invocationCallOrder[1]).toBeLessThan(
      (frickService.approvePaymentWithoutTan as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(fiatOutputRepo.update).toHaveBeenNthCalledWith(
      3,
      42,
      expect.objectContaining({ isApprovedDate: expect.any(Date) }),
    );
  });

  it('fills remittanceInfo with a default only when it was never set at all, and still keeps frickReference separate', async () => {
    Config.bank.frick.payoutEnabled = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue(order);
    jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue('4242');
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        amount: 10,
        currency: 'EUR',
        accountIban: 'SYNTHETIC-DEBTOR',
        name: 'Synthetic Recipient',
        iban: 'SYNTHETIC-CREDITOR',
        remittanceInfo: undefined,
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(
      { id: 42, frickCustomId: IsNull() },
      expect.objectContaining({ frickReference: 'DFX-FO-42' }),
    );
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ remittanceInfo: 'DFX Payout 42' }),
    );
  });

  it('persists frickReference in the atomic reserve so it is never stranded by a failure in the later, non-atomic update (crash/DB-blip after the order was already created at Bank Frick)', async () => {
    Config.bank.frick.payoutEnabled = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue(order);
    jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue('4242');
    // The reserve (1st update) still succeeds; the post-createPaymentOrder (2nd) update is what fails here.
    (fiatOutputRepo.update as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({ affected: 1, raw: {}, generatedMaps: [] })
      .mockRejectedValueOnce(new Error('synthetic DB blip'));
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        amount: 10,
        currency: 'EUR',
        accountIban: 'SYNTHETIC-DEBTOR',
        name: 'Synthetic Recipient',
        iban: 'SYNTHETIC-CREDITOR',
        remittanceInfo: 'Synthetic payout',
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    // The order WAS already created at Bank Frick (createPaymentOrder resolved) by the time the 2nd
    // update fails - frickReference must already be durably persisted from the 1st (reserve) call, or
    // reconciliation (frickReference ?? remittanceInfo) can never match the resulting bank debit.
    expect(fiatOutputRepo.update).toHaveBeenNthCalledWith(
      1,
      { id: 42, frickCustomId: IsNull() },
      { frickCustomId: 'DFX-FO-42', frickReference: 'DFX-FO-42 Synthetic payout' },
    );
  });

  it("re-persists isTransmittedDate and frickReference when a found order reveals a gap left by a crash between transmitPayments' two writes", async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue({ ...order, state: FrickPaymentState.IN_PROGRESS });
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        remittanceInfo: 'Synthetic payout',
        frickReference: undefined,
        isTransmittedDate: undefined,
        isComplete: false,
      }),
    ]);

    await service.checkFrickOrderStatus();

    // Bank Frick actually has this order (getPaymentOrder resolved), so the crash must have happened
    // between transmitPayments' reserve and its second write - heal both gaps here instead of leaving
    // the row permanently unmatched by reconciliation and permanently "not yet transmitted" for the
    // stuckFiatOutputs monitor.
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        isTransmittedDate: expect.any(Date),
        frickReference: 'DFX-FO-42 Synthetic payout',
      }),
    );
  });

  it('does not overwrite an already-set isTransmittedDate/frickReference during a routine status poll', async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue({ ...order, state: FrickPaymentState.IN_PROGRESS });
    const alreadyTransmitted = new Date('2026-01-01');
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        frickReference: 'DFX-FO-42 already-set',
        isTransmittedDate: alreadyTransmitted,
        isComplete: false,
      }),
    ]);

    await service.checkFrickOrderStatus();

    const call = (fiatOutputRepo.update as jest.Mock).mock.calls.find((c) => c[0] === 42);
    expect(call[1]).not.toHaveProperty('isTransmittedDate');
    expect(call[1]).not.toHaveProperty('frickReference');
  });

  it('does not create a second payment order when the reservation update reports zero affected rows', async () => {
    Config.bank.frick.payoutEnabled = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    // Simulates a concurrent worker (an overlapping cron tick or a second instance) having already
    // claimed this row between the SELECT and this UPDATE.
    jest.spyOn(fiatOutputRepo, 'update').mockResolvedValueOnce({ affected: 0, raw: {}, generatedMaps: [] });
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        amount: 10,
        currency: 'EUR',
        accountIban: 'SYNTHETIC-DEBTOR',
        name: 'Synthetic Recipient',
        iban: 'SYNTHETIC-CREDITOR',
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    expect(fiatOutputRepo.update).toHaveBeenCalledTimes(1);
    expect(frickService.createPaymentOrder).not.toHaveBeenCalled();
  });

  it('clears frickCustomId and retries cleanly after a definitive not-found from the status poller when transmission was never confirmed', async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockRejectedValue(new FrickPaymentOrderNotFoundError('DFX-FO-42'));
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isTransmittedDate: undefined,
        isComplete: false,
      }),
    ]);

    await service.checkFrickOrderStatus();

    // Conditional on the exact reserved state, not an unconditional-by-id clear: guards against the
    // clear firing after a concurrent transmitPayments reserved/transmitted the very same row in
    // between this snapshot and this write (see the dedicated race test below).
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(
      { id: 42, frickCustomId: 'DFX-FO-42', isTransmittedDate: IsNull() },
      { frickCustomId: null, frickError: null },
    );
    expect(frickService.approvePaymentWithoutTan).not.toHaveBeenCalled();
  });

  it('scopes the not-found self-heal clear to a conditional update instead of clearing unconditionally by id (guards against racing with a concurrent transmitPayments reservation)', async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockRejectedValue(new FrickPaymentOrderNotFoundError('DFX-FO-42'));
    // Simulates a concurrent transmitPayments tick having already reserved+transmitted this row between
    // this job's SELECT and this UPDATE: the conditional WHERE no longer matches, so the clear is a no-op.
    (fiatOutputRepo.update as jest.Mock).mockReset().mockResolvedValueOnce({ affected: 0, raw: {}, generatedMaps: [] });
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isTransmittedDate: undefined,
        isComplete: false,
      }),
    ]);

    await service.checkFrickOrderStatus();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(
      { id: 42, frickCustomId: 'DFX-FO-42', isTransmittedDate: IsNull() },
      { frickCustomId: null, frickError: null },
    );
    // Not called with the old unconditional-by-id form.
    expect(fiatOutputRepo.update).not.toHaveBeenCalledWith(42, { frickCustomId: null, frickError: null });
  });

  it('keeps frickCustomId and does not roll back on a non-not-found status error, even before transmission was confirmed', async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockRejectedValue(new Error('synthetic transport failure'));
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isTransmittedDate: undefined,
        isComplete: false,
      }),
    ]);

    await service.checkFrickOrderStatus();

    expect(fiatOutputRepo.update).not.toHaveBeenCalledWith(expect.anything(), {
      frickCustomId: null,
      frickError: null,
    });
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickError: 'FRICK status error: synthetic transport failure',
    });
  });

  it('does not self-heal a not-found error once transmission was already confirmed (defense in depth)', async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockRejectedValue(new FrickPaymentOrderNotFoundError('DFX-FO-42'));
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isTransmittedDate: new Date(),
        isComplete: false,
      }),
    ]);

    await service.checkFrickOrderStatus();

    expect(fiatOutputRepo.update).not.toHaveBeenCalledWith(expect.anything(), {
      frickCustomId: null,
      frickError: null,
    });
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickError: `FRICK status error: Bank Frick payment order DFX-FO-42 not found`,
    });
  });

  it('resolves a missing CHF creditor BIC and defaults the charge to SHA', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue({ ...order, currency: 'CHF' });
    jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue('4242');
    jest.spyOn(ibanService, 'getIbanInfos').mockResolvedValue({
      result: 'passed',
      bic_candidates: [{ bic: ' testli22xxx ' } as never],
      all_bic_candidates: [{ bic: 'TESTLI22XXX' } as never],
    });
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        amount: 10,
        currency: 'CHF',
        accountIban: 'SYNTHETIC-DEBTOR',
        name: 'Synthetic Recipient',
        iban: 'SYNTHETIC-CREDITOR',
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    expect(ibanService.getIbanInfos).toHaveBeenCalledWith('SYNTHETIC-CREDITOR');
    expect(frickService.createPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        charge: FrickPaymentCharge.SHARED,
        creditor: expect.objectContaining({ bic: 'TESTLI22XXX' }),
      }),
    );
    // The defaulted SHA decision is persisted onto the entity, not left as a NULL that looks unset.
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, expect.objectContaining({ charge: TransactionCharge.SHA }));
  });

  it.each([
    [{ result: 'failed' }, 'Unable to resolve creditor BIC'],
    [
      {
        result: 'passed',
        bic_candidates: [{ bic: 'TESTLI22' }],
        all_bic_candidates: [{ bic: 'OTHERLI2X' }],
      },
      'Ambiguous creditor BIC',
    ],
  ])('fails closed when CHF BIC resolution is not unique', async (ibanDetails, expectedError) => {
    Config.bank.frick.payoutEnabled = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(ibanService, 'getIbanInfos').mockResolvedValue(ibanDetails as never);
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        currency: 'CHF',
        iban: 'SYNTHETIC-CREDITOR',
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    expect(frickService.createPaymentOrder).not.toHaveBeenCalled();
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickError: expect.stringContaining(expectedError),
    });
  });

  it('fails closed when a CHF output has neither BIC nor creditor IBAN', async () => {
    Config.bank.frick.payoutEnabled = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        currency: 'CHF',
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    expect(ibanService.getIbanInfos).not.toHaveBeenCalled();
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickError: 'FRICK error: Bank Frick CHF payout requires creditor IBAN for BIC resolution',
    });
  });

  it('always keeps the stable custom id at the start of the bounded bank reference', () => {
    expect(service['createUniqueReference']('DFX-FO-42')).toBe('DFX-FO-42');
    expect(service['createUniqueReference']('DFX-FO-42', ' DFX-FO-42 ')).toBe('DFX-FO-42');
    const reference = service['createUniqueReference']('DFX-FO-42', 'x'.repeat(200));
    expect(reference).toHaveLength(140);
    expect(reference.startsWith('DFX-FO-42 ')).toBe(true);
    expect(Array.from(service['createUniqueReference']('DFX-FO-42', '😀'.repeat(200)))).toHaveLength(140);
  });

  it.each([
    [TransactionCharge.BEN, FrickPaymentCharge.BENEFICIARY],
    [TransactionCharge.OUR, FrickPaymentCharge.OUR],
    [TransactionCharge.SHA, FrickPaymentCharge.SHARED],
  ])('maps fiat-output charge %s to Bank Frick charge %s', async (charge, expectedCharge) => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue(order);
    jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue(undefined);
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        amount: 10,
        currency: 'CHF',
        charge,
        accountIban: 'SYNTHETIC-DEBTOR',
        name: 'Synthetic Recipient',
        iban: 'SYNTHETIC-CREDITOR',
        bic: 'TESTLI22',
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    expect(frickService.createPaymentOrder).toHaveBeenCalledWith(expect.objectContaining({ charge: expectedCharge }));
  });

  it('polls existing orders while payout creation is disabled and preserves a FRICK-prefixed operations note', async () => {
    Config.bank.frick.payoutEnabled = false;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue(order);
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isTransmittedDate: new Date('2026-01-01'),
        frickReference: 'DFX-FO-42 existing',
        isComplete: false,
        info: 'FRICK manual operations hold',
      }),
    ]);

    await service.checkFrickOrderStatus();

    expect(frickService.getPaymentOrder).toHaveBeenCalledWith('DFX-FO-42');
    expect(frickService.approvePaymentWithoutTan).not.toHaveBeenCalled();
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickOrderStatus: FrickPaymentState.PREPARED,
      frickError: null,
    });
    expect((fiatOutputRepo.update as jest.Mock).mock.calls[0][1]).not.toHaveProperty('info');

    const statusQuery = (fiatOutputRepo.find as jest.Mock).mock.calls[0][0].where;
    expect(statusQuery.every((where: object) => 'frickOrderStatus' in where)).toBe(true);
    expect(statusQuery.some((where: object) => 'info' in where)).toBe(false);
  });

  it('automatically approves a PREPARED order during status polling', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue(order);
    jest
      .spyOn(frickService, 'approvePaymentWithoutTan')
      .mockResolvedValue({ ...order, state: FrickPaymentState.BOOKED });
    jest
      .spyOn(fiatOutputRepo, 'find')
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickCustomId: 'DFX-FO-42', isComplete: false })]);

    await service.checkFrickOrderStatus();

    expect(frickService.approvePaymentWithoutTan).toHaveBeenCalledWith(order);
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        frickOrderStatus: FrickPaymentState.BOOKED,
        frickError: null,
        isApprovedDate: expect.any(Date),
        isConfirmedDate: expect.any(Date),
      }),
    );
  });

  it.each([
    [FrickPaymentState.IN_PROGRESS, false],
    [FrickPaymentState.EXECUTED, false],
    [FrickPaymentState.BOOKED, true],
  ])('persists the %s status transition', async (state, confirms) => {
    Config.bank.frick.payoutEnabled = false;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue({ ...order, state });
    jest
      .spyOn(fiatOutputRepo, 'find')
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickCustomId: 'DFX-FO-42', isComplete: false })]);

    await service.checkFrickOrderStatus();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        frickOrderStatus: state,
        frickError: null,
        isApprovedDate: expect.any(Date),
        ...(confirms && { isConfirmedDate: expect.any(Date) }),
      }),
    );
    if (!confirms)
      expect(fiatOutputRepo.update).not.toHaveBeenCalledWith(
        42,
        expect.objectContaining({ isConfirmedDate: expect.any(Date) }),
      );
  });

  it('persists the status when an IN_PROGRESS order was already approved', async () => {
    Config.bank.frick.payoutEnabled = false;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue({
      ...order,
      state: FrickPaymentState.IN_PROGRESS,
    });
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isApprovedDate: new Date('2026-07-01'),
        isTransmittedDate: new Date('2026-01-01'),
        frickReference: 'DFX-FO-42 existing',
        isComplete: false,
        info: undefined,
      }),
    ]);

    await service.checkFrickOrderStatus();

    expect(frickService.getPaymentOrder).toHaveBeenCalledWith('DFX-FO-42');
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickOrderStatus: FrickPaymentState.IN_PROGRESS,
      frickError: null,
    });
  });

  it('preserves an operations note when a status request fails', async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockRejectedValue(new Error('synthetic status failure'));
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isComplete: false,
        info: 'Manual operations note',
      }),
    ]);

    await service.checkFrickOrderStatus();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickError: 'FRICK status error: synthetic status failure',
    });
    expect((fiatOutputRepo.update as jest.Mock).mock.calls[0][1]).not.toHaveProperty('info');
  });

  it('records a bounded Bank Frick status error when no operations note exists', async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockRejectedValue(new Error('synthetic status failure'));
    jest
      .spyOn(fiatOutputRepo, 'find')
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickCustomId: 'DFX-FO-42', isComplete: false })]);

    await service.checkFrickOrderStatus();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickError: 'FRICK status error: synthetic status failure',
    });
  });

  it('records a generic status error message when the status request rejects with a non-Error value', async () => {
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockRejectedValue('synthetic non-error rejection');
    jest
      .spyOn(fiatOutputRepo, 'find')
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickCustomId: 'DFX-FO-42', isComplete: false })]);

    await service.checkFrickOrderStatus();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, { frickError: 'FRICK status error: unknown error' });
  });

  it('does not use a lone house number as the creditor address', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue(order);
    jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue('4242');
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        amount: 10,
        currency: 'EUR',
        accountIban: 'SYNTHETIC-DEBTOR',
        name: 'Synthetic Recipient',
        iban: 'SYNTHETIC-CREDITOR',
        address: undefined,
        houseNumber: '12',
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    expect(frickService.createPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({ creditor: expect.objectContaining({ address: undefined }) }),
    );
  });

  it('joins the street address and house number as the creditor address', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockResolvedValue(order);
    jest.spyOn(frickService, 'getSafeOrderId').mockReturnValue('4242');
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        amount: 10,
        currency: 'EUR',
        accountIban: 'SYNTHETIC-DEBTOR',
        name: 'Synthetic Recipient',
        iban: 'SYNTHETIC-CREDITOR',
        address: 'Synthetic Street',
        houseNumber: '12',
        bank: createCustomBank({ name: IbanBankName.FRICK }),
      }),
    ]);

    await service.transmitPayments();

    expect(frickService.createPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({ creditor: expect.objectContaining({ address: 'Synthetic Street 12' }) }),
    );
  });

  it('preserves an operations note when transmission fails', async () => {
    Config.bank.frick.payoutEnabled = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockRejectedValue(new Error('synthetic transmission failure'));
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        bank: createCustomBank({ name: IbanBankName.FRICK }),
        info: 'Manual operations note',
      }),
    ]);

    await service.transmitPayments();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickError: 'FRICK error: synthetic transmission failure',
    });
    // The error-update call specifically (not the earlier atomic reservation call) must not carry `info`
    const errorUpdateCall = (fiatOutputRepo.update as jest.Mock).mock.calls.find(
      (call) => call[0] === 42 && 'frickError' in call[1],
    );
    expect(errorUpdateCall[1]).not.toHaveProperty('info');
  });

  it('records a bounded Bank Frick transmission error when no operations note exists', async () => {
    Config.bank.frick.payoutEnabled = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockRejectedValue(new Error('synthetic transmission failure'));
    jest
      .spyOn(fiatOutputRepo, 'find')
      .mockResolvedValue([createCustomFiatOutput({ id: 42, bank: createCustomBank({ name: IbanBankName.FRICK }) })]);

    await service.transmitPayments();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickError: 'FRICK error: synthetic transmission failure',
    });
  });

  it('records a generic transmission error message when order creation rejects with a non-Error value', async () => {
    Config.bank.frick.payoutEnabled = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'createPaymentOrder').mockRejectedValue('synthetic non-error rejection');
    jest
      .spyOn(fiatOutputRepo, 'find')
      .mockResolvedValue([createCustomFiatOutput({ id: 42, bank: createCustomBank({ name: IbanBankName.FRICK }) })]);

    await service.transmitPayments();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, { frickError: 'FRICK error: unknown error' });
  });

  it('does not recreate a rejected order and records the terminal state', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue({
      ...order,
      state: FrickPaymentState.REJECTED,
    });
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isTransmittedDate: new Date('2026-01-01'),
        frickReference: 'DFX-FO-42 existing',
        isComplete: false,
      }),
    ]);

    await service.checkFrickOrderStatus();

    expect(frickService.createPaymentOrder).not.toHaveBeenCalled();
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickOrderStatus: FrickPaymentState.REJECTED,
      frickError: 'Bank Frick order terminated: REJECTED',
    });
  });

  it.each([FrickPaymentState.REJECTED, FrickPaymentState.EXPIRED, FrickPaymentState.DELETED, FrickPaymentState.ERROR])(
    'maps terminal state %s to the dedicated order status and records a descriptive reason when none existed',
    (state) => {
      expect(
        service['getFrickStatusUpdate'](
          { ...order, state },
          createCustomFiatOutput({ id: 42, frickCustomId: 'DFX-FO-42' }),
        ),
      ).toEqual({ frickOrderStatus: state, frickError: `Bank Frick order terminated: ${state}` });
    },
  );

  it('preserves an existing operations note on a terminal status instead of erasing it', () => {
    expect(
      service['getFrickStatusUpdate'](
        { ...order, state: FrickPaymentState.REJECTED },
        createCustomFiatOutput({ id: 42, frickCustomId: 'DFX-FO-42', frickError: 'FRICK error: prior failure note' }),
      ),
    ).toEqual({ frickOrderStatus: FrickPaymentState.REJECTED, frickError: 'FRICK error: prior failure note' });
  });

  it('treats DELETION_REQUESTED as a non-terminal status transition (no liquidity release, no isComplete)', () => {
    expect(
      service['getFrickStatusUpdate'](
        { ...order, state: FrickPaymentState.DELETION_REQUESTED },
        createCustomFiatOutput({ id: 42, frickCustomId: 'DFX-FO-42' }),
      ),
    ).toEqual({ frickOrderStatus: FrickPaymentState.DELETION_REQUESTED, frickError: null });
  });

  it.each([
    [FrickPaymentState.REJECTED, true],
    [FrickPaymentState.EXPIRED, true],
    [FrickPaymentState.DELETED, true],
    [FrickPaymentState.ERROR, true],
    [FrickPaymentState.DELETION_REQUESTED, false],
    [FrickPaymentState.PREPARED, false],
    [FrickPaymentState.IN_PROGRESS, false],
    [FrickPaymentState.BOOKED, false],
    [FrickPaymentState.EXECUTED, false],
  ])('classifies %s as terminal=%s for liquidity release and status-poll exclusion', (state, terminal) => {
    expect(service.isFrickTerminalState(state)).toBe(terminal);
  });

  it('never re-approves and keeps polling an order stuck in DELETION_REQUESTED', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = true;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest
      .spyOn(frickService, 'getPaymentOrder')
      .mockResolvedValue({ ...order, state: FrickPaymentState.DELETION_REQUESTED });
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isTransmittedDate: new Date('2026-01-01'),
        frickReference: 'DFX-FO-42 existing',
        isComplete: false,
        frickOrderStatus: FrickPaymentState.DELETION_REQUESTED,
      }),
    ]);

    await service.checkFrickOrderStatus();

    expect(frickService.approvePaymentWithoutTan).not.toHaveBeenCalled();
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickOrderStatus: FrickPaymentState.DELETION_REQUESTED,
      frickError: null,
    });
  });

  it('approves a PREPARED order in the status job even when the transmission process is disabled', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = true;
    jest
      .spyOn(processServiceModule, 'DisabledProcess')
      .mockImplementation((process) => process === processServiceModule.Process.FIAT_OUTPUT_FRICK_TRANSMISSION);
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue(order); // order.state === PREPARED
    jest
      .spyOn(frickService, 'approvePaymentWithoutTan')
      .mockResolvedValue({ ...order, state: FrickPaymentState.BOOKED });
    jest
      .spyOn(fiatOutputRepo, 'find')
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickCustomId: 'DFX-FO-42', isComplete: false })]);

    await service.checkFrickOrderStatus();

    expect(frickService.approvePaymentWithoutTan).toHaveBeenCalledWith(order);
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ frickOrderStatus: FrickPaymentState.BOOKED }),
    );
  });

  it('never approves in the status job when approveWithoutTan is disabled', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue(order); // order.state === PREPARED
    jest.spyOn(fiatOutputRepo, 'find').mockResolvedValue([
      createCustomFiatOutput({
        id: 42,
        frickCustomId: 'DFX-FO-42',
        isTransmittedDate: new Date('2026-01-01'),
        frickReference: 'DFX-FO-42 existing',
        isComplete: false,
      }),
    ]);

    await service.checkFrickOrderStatus();

    expect(frickService.approvePaymentWithoutTan).not.toHaveBeenCalled();
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickOrderStatus: FrickPaymentState.PREPARED,
      frickError: null,
    });
  });

  it('rejects an unsupported Bank Frick status instead of guessing', () => {
    expect(() =>
      service['getFrickStatusUpdate'](
        { ...order, state: 'UNKNOWN' as FrickPaymentState },
        createCustomFiatOutput({ id: 42, frickCustomId: 'DFX-FO-42' }),
      ),
    ).toThrow('Unsupported Bank Frick payment state');
  });
});
