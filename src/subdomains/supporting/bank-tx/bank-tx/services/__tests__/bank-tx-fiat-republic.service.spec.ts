import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FiatRepublicPaymentDirection,
  FiatRepublicPaymentResponse,
  FiatRepublicPaymentStatus,
} from 'src/integration/bank/dto/fiat-republic.dto';
import { FiatRepublicService } from 'src/integration/bank/services/fiat-republic.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { Bank } from '../../../../bank/bank/bank.entity';
import { BankService } from '../../../../bank/bank/bank.service';
import { IbanBankName } from '../../../../bank/bank/dto/bank.dto';
import { VirtualIbanService } from '../../../../bank/virtual-iban/virtual-iban.service';
import { BankTxIndicator } from '../../entities/bank-tx.entity';
import { BankTxFiatRepublicService } from '../bank-tx-fiat-republic.service';

function bank(overrides: Partial<Bank> = {}): Bank {
  return Object.assign(new Bank(), {
    id: 11,
    name: IbanBankName.FIAT_REPUBLIC,
    iban: 'DE00000000000000000000',
    currency: 'EUR',
    receive: true,
    send: true,
    ...overrides,
  });
}

function payment(overrides: Partial<FiatRepublicPaymentResponse> = {}): FiatRepublicPaymentResponse {
  return {
    id: 'pmt_synthetic',
    from: { id: 'pyr_synthetic', type: 'PAYER' },
    to: { id: 'vac_synthetic', type: 'VIRTUAL_ACCOUNT' },
    direction: FiatRepublicPaymentDirection.PAYIN,
    reference: 'Deposit from Synthetic',
    amount: '250.50',
    currency: 'EUR',
    paymentScheme: 'SCT',
    status: FiatRepublicPaymentStatus.COMPLETED,
    createdAt: 1654363247796,
    updatedAt: 1654363251739,
    ...overrides,
  };
}

describe('BankTxFiatRepublicService', () => {
  let service: BankTxFiatRepublicService;
  let fiatRepublicService: DeepMocked<FiatRepublicService>;
  let bankService: DeepMocked<BankService>;
  let settingService: DeepMocked<SettingService>;
  let virtualIbanService: DeepMocked<VirtualIbanService>;
  let createTx: jest.Mock;

  beforeEach(async () => {
    fiatRepublicService = createMock<FiatRepublicService>();
    bankService = createMock<BankService>();
    settingService = createMock<SettingService>();
    virtualIbanService = createMock<VirtualIbanService>();
    createTx = jest.fn().mockResolvedValue({});

    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
    jest.spyOn(fiatRepublicService, 'isBankTxSyncEnabled').mockReturnValue(true);
    bankService.getBanksByName.mockResolvedValue([bank()]);
    settingService.get.mockResolvedValue(new Date(0).toISOString());
    virtualIbanService.getByProviderAccountRef.mockResolvedValue(null);
    fiatRepublicService.getPayer.mockResolvedValue(undefined as never);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BankTxFiatRepublicService,
        { provide: FiatRepublicService, useValue: fiatRepublicService },
        { provide: BankService, useValue: bankService },
        { provide: SettingService, useValue: settingService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<BankTxFiatRepublicService>(BankTxFiatRepublicService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('checkTransactions', () => {
    it('does nothing while the process flag is off', async () => {
      jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);

      await service.checkTransactions(createTx, []);

      expect(fiatRepublicService.listPayments).not.toHaveBeenCalled();
    });

    it('does nothing while the bank-tx sync stage is not released', async () => {
      jest.spyOn(fiatRepublicService, 'isBankTxSyncEnabled').mockReturnValue(false);

      await service.checkTransactions(createTx, []);

      expect(fiatRepublicService.listPayments).not.toHaveBeenCalled();
    });

    it('warns only once while the rail stays unavailable', async () => {
      jest.spyOn(fiatRepublicService, 'isBankTxSyncEnabled').mockReturnValue(false);

      await service.checkTransactions(createTx, []);
      await service.checkTransactions(createTx, []);

      expect(fiatRepublicService.listPayments).not.toHaveBeenCalled();
    });

    it('does nothing without a receiving Fiat Republic bank row', async () => {
      bankService.getBanksByName.mockResolvedValue([bank({ receive: false })]);

      await service.checkTransactions(createTx, []);

      expect(fiatRepublicService.listPayments).not.toHaveBeenCalled();
    });

    it('ignores a Fiat Republic row of another currency', async () => {
      bankService.getBanksByName.mockResolvedValue([bank({ currency: 'GBP' })]);

      await service.checkTransactions(createTx, []);

      expect(fiatRepublicService.listPayments).not.toHaveBeenCalled();
    });

    it('imports completed payins and advances the watermark', async () => {
      fiatRepublicService.listPayments.mockResolvedValue([payment()] as never);

      await service.checkTransactions(createTx, []);

      expect(createTx).toHaveBeenCalledWith(expect.objectContaining({ accountServiceRef: 'pmt_synthetic' }), []);
      expect(settingService.setDateMax).toHaveBeenCalledWith('lastBankFiatRepublicDate:11', expect.any(Date));
    });

    it.each([
      ['payouts', payment({ direction: FiatRepublicPaymentDirection.PAYOUT })],
      ['payins still under compliance review', payment({ status: FiatRepublicPaymentStatus.COMPLIANCE_REVIEW })],
      ['failed payins', payment({ status: FiatRepublicPaymentStatus.FAILED })],
    ])('does not book %s', async (_name, entry) => {
      fiatRepublicService.listPayments.mockResolvedValue([entry] as never);

      await service.checkTransactions(createTx, []);

      expect(createTx).not.toHaveBeenCalled();
    });

    it('holds the cursor at a payin that has not settled yet', async () => {
      // A payin can sit in compliance review for days while keeping its createdAt. Advancing past it
      // would drop it out of every future window — and if the webhook also failed, the money would
      // arrive and never be booked.
      const createdAt = new Date('2026-08-01T10:00:00.000Z').getTime();
      fiatRepublicService.listPayments.mockResolvedValue([
        payment({ status: FiatRepublicPaymentStatus.COMPLIANCE_REVIEW, createdAt }),
      ] as never);

      await service.checkTransactions(createTx, []);

      expect(settingService.setDateMax).toHaveBeenCalledWith('lastBankFiatRepublicDate:11', new Date(createdAt));
    });

    it('holds the cursor at the oldest unsettled payin, not the newest', async () => {
      const oldest = new Date('2026-08-01T10:00:00.000Z').getTime();
      fiatRepublicService.listPayments.mockResolvedValue([
        payment({ id: 'pmt_b', status: FiatRepublicPaymentStatus.PROCESSING, createdAt: oldest + 86_400_000 }),
        payment({ id: 'pmt_a', status: FiatRepublicPaymentStatus.COMPLIANCE_REVIEW, createdAt: oldest }),
      ] as never);

      await service.checkTransactions(createTx, []);

      expect(settingService.setDateMax).toHaveBeenCalledWith('lastBankFiatRepublicDate:11', new Date(oldest));
    });

    it('is not held back by an unsettled payout', async () => {
      fiatRepublicService.listPayments.mockResolvedValue([
        payment({
          direction: FiatRepublicPaymentDirection.PAYOUT,
          status: FiatRepublicPaymentStatus.PROCESSING,
          createdAt: new Date('2026-08-01T10:00:00.000Z').getTime(),
        }),
      ] as never);

      await service.checkTransactions(createTx, []);

      const [[, watermark]] = settingService.setDateMax.mock.calls;
      expect(watermark.getTime()).toBeGreaterThan(new Date('2026-08-01T10:00:00.000Z').getTime());
    });

    it('ignores an unsettled payin whose timestamp is unusable', async () => {
      fiatRepublicService.listPayments.mockResolvedValue([
        payment({ status: FiatRepublicPaymentStatus.PROCESSING, createdAt: undefined }),
      ] as never);

      await service.checkTransactions(createTx, []);

      expect(settingService.setDateMax).toHaveBeenCalled();
    });

    it('does not advance the watermark on an empty window', async () => {
      fiatRepublicService.listPayments.mockResolvedValue([] as never);

      await service.checkTransactions(createTx, []);

      expect(settingService.setDateMax).not.toHaveBeenCalled();
    });

    it('treats a null listing as an empty window', async () => {
      fiatRepublicService.listPayments.mockResolvedValue(undefined as never);

      await service.checkTransactions(createTx, []);

      expect(createTx).not.toHaveBeenCalled();
      expect(settingService.setDateMax).not.toHaveBeenCalled();
    });

    it('does not advance the watermark when the listing itself failed', async () => {
      fiatRepublicService.listPayments.mockRejectedValue(new Error('gateway timeout'));

      await service.checkTransactions(createTx, []);

      expect(settingService.setDateMax).not.toHaveBeenCalled();
    });

    it('treats a duplicate as processed and keeps advancing', async () => {
      fiatRepublicService.listPayments.mockResolvedValue([payment()] as never);
      createTx.mockRejectedValue(new ConflictException('already imported'));

      await service.checkTransactions(createTx, []);

      expect(settingService.setDateMax).toHaveBeenCalled();
    });

    it('holds the watermark back when a payment could not be imported', async () => {
      fiatRepublicService.listPayments.mockResolvedValue([payment()] as never);
      createTx.mockRejectedValue(new Error('database down'));

      await service.checkTransactions(createTx, []);

      expect(settingService.setDateMax).not.toHaveBeenCalled();
    });

    it('reads the whole window, not just its first page', async () => {
      const first = Array.from({ length: 100 }, (_, i) => payment({ id: `pmt_${i}` }));
      fiatRepublicService.listPayments
        .mockResolvedValueOnce(first as never)
        .mockResolvedValueOnce([payment({ id: 'pmt_last' })] as never);

      await service.checkTransactions(createTx, []);

      expect(fiatRepublicService.listPayments).toHaveBeenCalledTimes(2);
      expect(fiatRepublicService.listPayments).toHaveBeenLastCalledWith(expect.any(Date), expect.any(Date), 100, 100);
      expect(createTx).toHaveBeenCalledTimes(101);
    });

    it('stops paging on an empty page', async () => {
      const first = Array.from({ length: 100 }, (_, i) => payment({ id: `pmt_${i}` }));
      fiatRepublicService.listPayments.mockResolvedValueOnce(first as never).mockResolvedValueOnce([] as never);

      await service.checkTransactions(createTx, []);

      expect(createTx).toHaveBeenCalledTimes(100);
      expect(settingService.setDateMax).toHaveBeenCalled();
    });

    it('never reports a truncated window as complete', async () => {
      const full = Array.from({ length: 100 }, (_, i) => payment({ id: `pmt_${i}` }));
      fiatRepublicService.listPayments.mockResolvedValue(full as never);

      await service.checkTransactions(createTx, []);

      expect(settingService.setDateMax).not.toHaveBeenCalled();
    });

    it('reads the persisted watermark for the bank row', async () => {
      fiatRepublicService.listPayments.mockResolvedValue([] as never);
      settingService.get.mockResolvedValue('2026-08-01T00:00:00.000Z');

      await service.checkTransactions(createTx, []);

      expect(settingService.get).toHaveBeenCalledWith('lastBankFiatRepublicDate:11', expect.any(String));
      expect(fiatRepublicService.listPayments).toHaveBeenCalledWith(
        new Date('2026-08-01T00:00:00.000Z'),
        expect.any(Date),
        100,
        0,
      );
    });
  });

  describe('toBankTx', () => {
    it('maps a payin onto a credit bank transaction', async () => {
      const result = await service.toBankTx(payment(), bank());

      expect(result).toMatchObject({
        accountServiceRef: 'pmt_synthetic',
        amount: 250.5,
        currency: 'EUR',
        instructedAmount: 250.5,
        txAmount: 250.5,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'DE00000000000000000000',
        remittanceInfo: 'Deposit from Synthetic',
      });
      expect(JSON.parse(result.txRaw)).toMatchObject({ id: 'pmt_synthetic' });
    });

    it('resolves the bank row itself when none is passed', async () => {
      const result = await service.toBankTx(payment());

      expect(result.accountIban).toBe('DE00000000000000000000');
    });

    it('throws when no receiving Fiat Republic account is configured', async () => {
      bankService.getBanksByName.mockResolvedValue([]);

      await expect(service.toBankTx(payment())).rejects.toThrow('No receiving Fiat Republic account');
    });

    it('resolves the customer personal IBAN from the virtual account id', async () => {
      virtualIbanService.getByProviderAccountRef.mockResolvedValue({ iban: 'DE99' } as never);

      const result = await service.toBankTx(payment(), bank());

      expect(virtualIbanService.getByProviderAccountRef).toHaveBeenCalledWith('vac_synthetic');
      expect(result.virtualIban).toBe('DE99');
    });

    it.each([
      ['the target is the master account', payment({ to: { id: 'fac_synthetic', type: 'FIAT_ACCOUNT' } })],
      ['there is no target', payment({ to: undefined })],
      ['the target has no id', payment({ to: { id: undefined, type: 'VIRTUAL_ACCOUNT' } as never })],
    ])('leaves the personal IBAN unset when %s', async (_name, entry) => {
      const result = await service.toBankTx(entry, bank());

      expect(result.virtualIban).toBeUndefined();
      expect(virtualIbanService.getByProviderAccountRef).not.toHaveBeenCalled();
    });

    it('still books the payin when the virtual account lookup fails', async () => {
      virtualIbanService.getByProviderAccountRef.mockRejectedValue(new Error('database down'));

      const result = await service.toBankTx(payment(), bank());

      expect(result.accountServiceRef).toBe('pmt_synthetic');
      expect(result.virtualIban).toBeUndefined();
    });

    it('enriches the counterparty from the payer', async () => {
      fiatRepublicService.getPayer.mockResolvedValue({
        id: 'pyr_synthetic',
        type: 'PERSON',
        name: 'Synthetic Payer',
        bankDetails: { iban: 'DE11', bic: 'SYNTDEFF', bankName: 'Synthetic Bank' },
        createdAt: 1,
        updatedAt: 1,
      } as never);

      const result = await service.toBankTx(payment(), bank());

      expect(result).toMatchObject({
        name: 'Synthetic Payer',
        iban: 'DE11',
        bic: 'SYNTDEFF',
        bankName: 'Synthetic Bank',
      });
    });

    it.each([
      ['the source is not a payer', payment({ from: { id: 'fac_x', type: 'FIAT_ACCOUNT' } })],
      ['there is no source', payment({ from: undefined })],
    ])('skips the payer lookup when %s', async (_name, entry) => {
      await service.toBankTx(entry, bank());

      expect(fiatRepublicService.getPayer).not.toHaveBeenCalled();
    });

    it('still books the payin when the payer lookup fails', async () => {
      fiatRepublicService.getPayer.mockRejectedValue(new Error('gateway timeout'));

      const result = await service.toBankTx(payment(), bank());

      expect(result.accountServiceRef).toBe('pmt_synthetic');
      expect(result.name).toBeUndefined();
    });

    it('reads millisecond timestamps as milliseconds', async () => {
      const result = await service.toBankTx(payment({ createdAt: 1654363247796, updatedAt: 1654363251739 }), bank());

      expect(result.bookingDate).toEqual(new Date(1654363247796));
      expect(result.valueDate).toEqual(new Date(1654363251739));
    });

    it('reads microsecond timestamps as microseconds', async () => {
      const result = await service.toBankTx(
        payment({ createdAt: 1654363247796000, updatedAt: 1654363251739000 }),
        bank(),
      );

      expect(result.bookingDate).toEqual(new Date(1654363247796));
      expect(result.valueDate).toEqual(new Date(1654363251739));
    });

    it('falls back to the booking date when there is no update timestamp', async () => {
      const result = await service.toBankTx(payment({ updatedAt: undefined }), bank());

      expect(result.valueDate).toEqual(result.bookingDate);
    });

    it('leaves both dates unset when neither timestamp is usable', async () => {
      const result = await service.toBankTx(payment({ createdAt: undefined, updatedAt: undefined }), bank());

      expect(result.bookingDate).toBeUndefined();
      expect(result.valueDate).toBeUndefined();
    });
  });
});
