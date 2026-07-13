import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { FrickPaymentCharge, FrickPaymentState, FrickPaymentType } from 'src/integration/bank/dto/frick.dto';
import { BankFrickService } from 'src/integration/bank/services/frick.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
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
    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatOutputFrickService,
        { provide: FiatOutputRepository, useValue: fiatOutputRepo },
        { provide: BankFrickService, useValue: frickService },

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
      expect.objectContaining({ customId: 'DFX-FO-42', reference: 'Synthetic payout' }),
    );
    expect(fiatOutputRepo.update).toHaveBeenNthCalledWith(
      1,
      42,
      expect.objectContaining({
        frickTxId: 'DFX-FO-42',
        frickOrderId: '4242',
        isTransmittedDate: expect.any(Date),
      }),
    );
    expect((fiatOutputRepo.update as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (frickService.approvePaymentWithoutTan as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(fiatOutputRepo.update).toHaveBeenNthCalledWith(
      2,
      42,
      expect.objectContaining({ isApprovedDate: expect.any(Date) }),
    );
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
        frickTxId: 'DFX-FO-42',
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
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

    await service.checkFrickOrderStatus();

    expect(frickService.approvePaymentWithoutTan).toHaveBeenCalledWith('DFX-FO-42');
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
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

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
        frickTxId: 'DFX-FO-42',
        isApprovedDate: new Date('2026-07-01'),
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
        frickTxId: 'DFX-FO-42',
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
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

    await service.checkFrickOrderStatus();

    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickError: 'FRICK status error: synthetic status failure',
    });
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
    expect((fiatOutputRepo.update as jest.Mock).mock.calls[0][1]).not.toHaveProperty('info');
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

  it('does not recreate a rejected order and records the terminal state', async () => {
    Config.bank.frick.payoutEnabled = true;
    Config.bank.frick.approveWithoutTan = false;
    jest.spyOn(frickService, 'isAvailable').mockReturnValue(true);
    jest.spyOn(frickService, 'getPaymentOrder').mockResolvedValue({
      ...order,
      state: FrickPaymentState.REJECTED,
    });
    jest
      .spyOn(fiatOutputRepo, 'find')
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

    await service.checkFrickOrderStatus();

    expect(frickService.createPaymentOrder).not.toHaveBeenCalled();
    expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
      frickOrderStatus: FrickPaymentState.REJECTED,
      frickError: null,
    });
  });

  it.each([FrickPaymentState.REJECTED, FrickPaymentState.EXPIRED, FrickPaymentState.DELETED, FrickPaymentState.ERROR])(
    'maps terminal state %s to the dedicated order status',
    (state) => {
      expect(
        service['getFrickStatusUpdate'](
          { ...order, state },
          createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42' }),
        ),
      ).toEqual({ frickOrderStatus: state, frickError: null });
    },
  );

  it('treats DELETION_REQUESTED as a non-terminal status transition (no liquidity release, no isComplete)', () => {
    expect(
      service['getFrickStatusUpdate'](
        { ...order, state: FrickPaymentState.DELETION_REQUESTED },
        createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42' }),
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
        frickTxId: 'DFX-FO-42',
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
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

    await service.checkFrickOrderStatus();

    expect(frickService.approvePaymentWithoutTan).toHaveBeenCalledWith('DFX-FO-42');
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
    jest
      .spyOn(fiatOutputRepo, 'find')
      .mockResolvedValue([createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42', isComplete: false })]);

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
        createCustomFiatOutput({ id: 42, frickTxId: 'DFX-FO-42' }),
      ),
    ).toThrow('Unsupported Bank Frick payment state');
  });
});
