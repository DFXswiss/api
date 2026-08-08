import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import {
  FiatRepublicMatchLevel,
  FiatRepublicPaymentDirection,
  FiatRepublicPaymentResponse,
  FiatRepublicPaymentScheme,
  FiatRepublicPaymentStatus,
} from 'src/integration/bank/dto/fiat-republic.dto';
import { FiatRepublicEndUserService } from 'src/integration/bank/services/fiat-republic-end-user.service';
import { FiatRepublicPayeeService } from 'src/integration/bank/services/fiat-republic-payee.service';
import { FiatRepublicNotFoundError, FiatRepublicService } from 'src/integration/bank/services/fiat-republic.service';
import { IbanService } from 'src/integration/bank/services/iban.service';
import * as processServiceModule from 'src/shared/services/process.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { IbanBankName } from '../../bank/bank/dto/bank.dto';
import { VirtualIbanService } from '../../bank/virtual-iban/virtual-iban.service';
import { FiatOutputFiatRepublicService } from '../fiat-output-fiat-republic.service';
import { FiatOutput } from '../fiat-output.entity';
import { FiatOutputRepository } from '../fiat-output.repository';

function output(overrides: Partial<FiatOutput> = {}): FiatOutput {
  return Object.assign(new FiatOutput(), {
    id: 42,
    amount: 250.5,
    currency: 'EUR',
    iban: 'DE89370400440532013000',
    bic: 'SYNTDEFF',
    name: 'Synthetic Person',
    address: 'Street',
    houseNumber: '1',
    zip: '0000',
    city: 'City',
    country: 'DE',
    accountIban: 'DE99999999999999999999',
    remittanceInfo: 'Payout',
    isReadyDate: new Date('2026-08-01T00:00:00.000Z'),
    isComplete: false,
    created: new Date('2026-08-01T00:00:00.000Z'),
    updated: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  });
}

function payment(overrides: Partial<FiatRepublicPaymentResponse> = {}): FiatRepublicPaymentResponse {
  return {
    id: 'pmt_synthetic',
    direction: FiatRepublicPaymentDirection.PAYOUT,
    reference: 'DFX-FO-42 Payout',
    amount: '250.50',
    currency: 'EUR',
    paymentScheme: 'SCT',
    status: FiatRepublicPaymentStatus.CREATED,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('FiatOutputFiatRepublicService', () => {
  let service: FiatOutputFiatRepublicService;
  let fiatOutputRepo: DeepMocked<FiatOutputRepository>;
  let fiatRepublicService: DeepMocked<FiatRepublicService>;
  let payeeService: DeepMocked<FiatRepublicPayeeService>;
  let endUserService: DeepMocked<FiatRepublicEndUserService>;
  let virtualIbanService: DeepMocked<VirtualIbanService>;
  let ibanService: DeepMocked<IbanService>;

  beforeEach(async () => {
    fiatOutputRepo = createMock<FiatOutputRepository>();
    fiatRepublicService = createMock<FiatRepublicService>();
    payeeService = createMock<FiatRepublicPayeeService>();
    endUserService = createMock<FiatRepublicEndUserService>();
    virtualIbanService = createMock<VirtualIbanService>();
    ibanService = createMock<IbanService>();

    jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
    jest.spyOn(fiatRepublicService, 'isPayoutEnabled').mockReturnValue(true);
    fiatOutputRepo.update.mockResolvedValue({ affected: 1, raw: {}, generatedMaps: [] });
    payeeService.getOrCreatePayee.mockResolvedValue('pye_synthetic');
    payeeService.createVerification.mockResolvedValue({
      verificationId: 'pvn_synthetic',
      matchLevel: FiatRepublicMatchLevel.MATCH,
    });
    fiatRepublicService.createPayment.mockResolvedValue(payment() as never);
    virtualIbanService.getByIban.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatOutputFiatRepublicService,
        { provide: FiatOutputRepository, useValue: fiatOutputRepo },
        { provide: FiatRepublicService, useValue: fiatRepublicService },
        { provide: FiatRepublicPayeeService, useValue: payeeService },
        { provide: FiatRepublicEndUserService, useValue: endUserService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        { provide: IbanService, useValue: ibanService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<FiatOutputFiatRepublicService>(FiatOutputFiatRepublicService);
    Config.bank.fiatRepublic.masterFiatAccountId = 'fac_synthetic';
  });

  afterEach(() => {
    Config.bank.fiatRepublic.masterFiatAccountId = undefined;
    jest.restoreAllMocks();
  });

  describe('canCreatePayments', () => {
    it('requires both the kill switch and the payout release', () => {
      expect(service.canCreatePayments()).toBe(true);

      jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);
      expect(service.canCreatePayments()).toBe(false);

      jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(false);
      jest.spyOn(fiatRepublicService, 'isPayoutEnabled').mockReturnValue(false);
      expect(service.canCreatePayments()).toBe(false);
    });
  });

  describe('isTerminalState', () => {
    it.each([
      [FiatRepublicPaymentStatus.COMPLETED, true],
      [FiatRepublicPaymentStatus.REJECTED, true],
      [FiatRepublicPaymentStatus.FAILED, true],
      [FiatRepublicPaymentStatus.RETURNED, true],
      [FiatRepublicPaymentStatus.PROCESSING, false],
      [FiatRepublicPaymentStatus.COMPLIANCE_REVIEW, false],
      [undefined, false],
    ])('reports %s as terminal=%s', (status, expected) => {
      expect(service.isTerminalState(status)).toBe(expected);
    });
  });

  describe('transmitPayments', () => {
    it('does nothing when payouts are not released', async () => {
      jest.spyOn(fiatRepublicService, 'isPayoutEnabled').mockReturnValue(false);

      await service.transmitPayments();

      expect(fiatOutputRepo.find).not.toHaveBeenCalled();
    });

    it('only picks up unreserved, ready, incomplete Fiat Republic rows', async () => {
      fiatOutputRepo.find.mockResolvedValue([]);

      await service.transmitPayments();

      expect(fiatOutputRepo.find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          fiatRepublicCustomId: expect.anything(),
          isComplete: false,
          bank: { name: IbanBankName.FIAT_REPUBLIC },
        }),
      });
    });

    it('creates the payee before reserving the row', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);

      await service.transmitPayments();

      const payeeCallOrder = payeeService.getOrCreatePayee.mock.invocationCallOrder[0];
      const reserveCallOrder = fiatOutputRepo.update.mock.invocationCallOrder[0];
      expect(payeeCallOrder).toBeLessThan(reserveCallOrder);
    });

    it('reserves the row atomically with the deterministic custom id and reference', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);

      await service.transmitPayments();

      expect(fiatOutputRepo.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 42 }), {
        fiatRepublicCustomId: 'DFX-FO-42',
        fiatRepublicReference: 'DFX-FO-42 Payout',
      });
    });

    it('skips a row another process reserved first', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);
      fiatOutputRepo.update.mockResolvedValue({ affected: 0, raw: {}, generatedMaps: [] });

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).not.toHaveBeenCalled();
      expect(payeeService.createVerification).not.toHaveBeenCalled();
    });

    it('creates the verification immediately before the payment, never earlier', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);

      await service.transmitPayments();

      expect(payeeService.createVerification.mock.invocationCallOrder[0]).toBeGreaterThan(
        fiatOutputRepo.update.mock.invocationCallOrder[0],
      );
      expect(payeeService.createVerification.mock.invocationCallOrder[0]).toBeLessThan(
        fiatRepublicService.createPayment.mock.invocationCallOrder[0],
      );
    });

    it('sends an SCT payment from the master account with the verification attached', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).toHaveBeenCalledWith(
        {
          fromId: 'fac_synthetic',
          toId: 'pye_synthetic',
          amount: '250.50',
          reference: 'DFX-FO-42 Payout',
          paymentScheme: FiatRepublicPaymentScheme.SCT,
          payeeVerificationId: 'pvn_synthetic',
        },
        'DFX-FO-42',
      );
    });

    it('sends from the customer virtual account when they hold one', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);
      virtualIbanService.getByIban.mockResolvedValue({
        bank: { name: IbanBankName.FIAT_REPUBLIC },
        providerAccountRef: 'vac_synthetic',
        userData: { id: 7 },
      } as never);
      endUserService.findEndUserId.mockResolvedValue('eus_synthetic');

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ fromId: 'vac_synthetic' }),
        'DFX-FO-42',
      );
      expect(payeeService.getOrCreatePayee).toHaveBeenCalledWith(
        expect.objectContaining({ endUserId: 'eus_synthetic' }),
      );
    });

    it('falls back to the master account for a virtual IBAN of another bank', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);
      virtualIbanService.getByIban.mockResolvedValue({
        bank: { name: IbanBankName.FRICK },
        providerAccountRef: 'vban_other',
        userData: { id: 7 },
      } as never);

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ fromId: 'fac_synthetic' }),
        'DFX-FO-42',
      );
    });

    it('creates a member-level payee when the virtual account has no owner', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);
      virtualIbanService.getByIban.mockResolvedValue({
        bank: { name: IbanBankName.FIAT_REPUBLIC },
        providerAccountRef: 'vac_synthetic',
        userData: null,
      } as never);

      await service.transmitPayments();

      expect(payeeService.getOrCreatePayee).toHaveBeenCalledWith(expect.objectContaining({ endUserId: undefined }));
    });

    it('records the failure instead of the master account when none is configured', async () => {
      Config.bank.fiatRepublic.masterFiatAccountId = undefined;
      fiatOutputRepo.find.mockResolvedValue([output()]);

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).not.toHaveBeenCalled();
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
        fiatRepublicError: expect.stringContaining('master fiat account is not configured'),
      });
    });

    it('resolves a missing creditor BIC from the IBAN', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ bic: undefined })]);
      ibanService.getIbanInfos.mockResolvedValue({ bic_candidates: [{ bic: 'synt deff' }] } as never);

      await service.transmitPayments();

      expect(payeeService.getOrCreatePayee).toHaveBeenCalledWith(expect.objectContaining({ bic: 'SYNTDEFF' }));
    });

    it('falls back to the wider BIC candidate list and ignores blank entries', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ bic: undefined })]);
      ibanService.getIbanInfos.mockResolvedValue({
        all_bic_candidates: [{ bic: undefined }, { bic: 'SYNTDEFF' }],
      } as never);

      await service.transmitPayments();

      expect(payeeService.getOrCreatePayee).toHaveBeenCalledWith(expect.objectContaining({ bic: 'SYNTDEFF' }));
    });

    it('accepts the same BIC appearing in both candidate lists', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ bic: undefined })]);
      ibanService.getIbanInfos.mockResolvedValue({
        bic_candidates: [{ bic: 'SYNTDEFF' }],
        all_bic_candidates: [{ bic: 'SYNTDEFF' }],
      } as never);

      await service.transmitPayments();

      expect(payeeService.getOrCreatePayee).toHaveBeenCalledWith(expect.objectContaining({ bic: 'SYNTDEFF' }));
    });

    it.each([
      ['no candidate', { bic_candidates: [] }],
      ['no candidate lists at all', {}],
      ['two different candidates', { bic_candidates: [{ bic: 'AAAADEFF' }, { bic: 'BBBBDEFF' }] }],
    ])('refuses to guess a creditor BIC with %s', async (_name, infos) => {
      fiatOutputRepo.find.mockResolvedValue([output({ bic: undefined })]);
      ibanService.getIbanInfos.mockResolvedValue(infos as never);

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).not.toHaveBeenCalled();
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
        fiatRepublicError: expect.stringContaining('creditor BIC'),
      });
    });

    it('refuses a payout without a creditor IBAN', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ bic: undefined, iban: undefined })]);

      await service.transmitPayments();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
        fiatRepublicError: expect.stringContaining('requires a creditor IBAN'),
      });
    });

    it('uses the custom id alone when the row carries no remittance info', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ remittanceInfo: undefined })]);

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'DFX-FO-42' }),
        'DFX-FO-42',
      );
      expect(fiatOutputRepo.update).toHaveBeenLastCalledWith(
        42,
        expect.objectContaining({ remittanceInfo: 'DFX Payout 42' }),
      );
    });

    it('does not duplicate the custom id when the remittance info already is it', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ remittanceInfo: 'DFX-FO-42' })]);

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'DFX-FO-42' }),
        'DFX-FO-42',
      );
    });

    it('truncates an over-long reference to the SEPA limit', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ remittanceInfo: 'x'.repeat(200) })]);

      await service.transmitPayments();

      const [[request]] = fiatRepublicService.createPayment.mock.calls;
      expect(request.reference).toHaveLength(140);
      expect(request.reference.startsWith('DFX-FO-42 ')).toBe(true);
    });

    it('never rewrites the customer-facing remittance info with the bank-bound reference', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);

      await service.transmitPayments();

      const updates = fiatOutputRepo.update.mock.calls.map(([, data]) => data);
      expect(updates.some((u) => 'remittanceInfo' in (u as object))).toBe(false);
    });

    it('persists the payment id, transmission date and match level', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);

      await service.transmitPayments();

      expect(fiatOutputRepo.update).toHaveBeenLastCalledWith(
        42,
        expect.objectContaining({
          fiatRepublicPaymentId: 'pmt_synthetic',
          fiatRepublicMatchLevel: FiatRepublicMatchLevel.MATCH,
          isTransmittedDate: expect.any(Date),
          fiatRepublicPaymentStatus: FiatRepublicPaymentStatus.CREATED,
        }),
      );
    });

    it('records an accepted name mismatch on the row', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);
      payeeService.createVerification.mockResolvedValue({
        verificationId: 'pvn_synthetic',
        matchLevel: FiatRepublicMatchLevel.NO_MATCH,
      });

      await service.transmitPayments();

      expect(fiatOutputRepo.update).toHaveBeenLastCalledWith(
        42,
        expect.objectContaining({ fiatRepublicMatchLevel: FiatRepublicMatchLevel.NO_MATCH }),
      );
    });

    it('rounds the amount to two decimals', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ amount: 10.005 })]);

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '10.01' }),
        'DFX-FO-42',
      );
    });

    it('keeps going after one row failed', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ id: 1 }), output({ id: 2 })]);
      payeeService.getOrCreatePayee.mockRejectedValueOnce(new Error('payee down'));

      await service.transmitPayments();

      expect(fiatRepublicService.createPayment).toHaveBeenCalledTimes(1);
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(1, {
        fiatRepublicError: expect.stringContaining('payee down'),
      });
    });

    it('bounds the persisted error text', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);
      payeeService.getOrCreatePayee.mockRejectedValue(new Error('x'.repeat(500)));

      await service.transmitPayments();

      const [[, data]] = fiatOutputRepo.update.mock.calls;
      expect((data as { fiatRepublicError: string }).fiatRepublicError.length).toBeLessThanOrEqual(256);
    });

    it('reports a non-Error failure without crashing', async () => {
      fiatOutputRepo.find.mockResolvedValue([output()]);
      payeeService.getOrCreatePayee.mockRejectedValue('not an error');

      await service.transmitPayments();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
        fiatRepublicError: expect.stringContaining('unknown error'),
      });
    });
  });

  describe('checkFiatRepublicPaymentStatus', () => {
    it('does nothing while its own kill switch is set', async () => {
      jest.spyOn(processServiceModule, 'DisabledProcess').mockReturnValue(true);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.find).not.toHaveBeenCalled();
    });

    it('does nothing while payouts are not released', async () => {
      jest.spyOn(fiatRepublicService, 'isPayoutEnabled').mockReturnValue(false);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.find).not.toHaveBeenCalled();
    });

    it('leaves a freshly reserved row alone while its transmission may still be in flight', async () => {
      // The transmission reserves the row and then spends up to the HTTP timeout inside
      // createPayment. Looking it up in that window would find nothing and release the claim,
      // letting a second attempt start against a payment that is already on its way.
      fiatOutputRepo.find.mockResolvedValue([output({ fiatRepublicCustomId: 'DFX-FO-42', updated: new Date() })]);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatRepublicService.findPaymentByReference).not.toHaveBeenCalled();
      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });

    it('does not hold back a freshly updated row that already carries a payment id', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({
          fiatRepublicCustomId: 'DFX-FO-42',
          fiatRepublicPaymentId: 'pmt_synthetic',
          isTransmittedDate: new Date(),
          updated: new Date(),
        }),
      ]);
      fiatRepublicService.getPayment.mockResolvedValue(payment() as never);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatRepublicService.getPayment).toHaveBeenCalled();
    });

    it('does not hold back a freshly updated row that already carries a status', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({
          fiatRepublicCustomId: 'DFX-FO-42',
          fiatRepublicPaymentStatus: FiatRepublicPaymentStatus.PROCESSING,
          updated: new Date(),
        }),
      ]);
      fiatRepublicService.findPaymentByReference.mockResolvedValue(payment() as never);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatRepublicService.findPaymentByReference).toHaveBeenCalled();
    });

    it('does not hold back a row without an update timestamp', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ fiatRepublicCustomId: 'DFX-FO-42', updated: undefined })]);
      fiatRepublicService.findPaymentByReference.mockResolvedValue(payment() as never);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatRepublicService.findPaymentByReference).toHaveBeenCalled();
    });

    it('reads the payment directly when its id is known', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({
          fiatRepublicCustomId: 'DFX-FO-42',
          fiatRepublicPaymentId: 'pmt_synthetic',
          isTransmittedDate: new Date(),
        }),
      ]);
      fiatRepublicService.getPayment.mockResolvedValue(
        payment({ status: FiatRepublicPaymentStatus.COMPLETED }) as never,
      );

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatRepublicService.getPayment).toHaveBeenCalledWith('pmt_synthetic');
      expect(fiatOutputRepo.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          fiatRepublicPaymentStatus: FiatRepublicPaymentStatus.COMPLETED,
          isApprovedDate: expect.any(Date),
          isConfirmedDate: expect.any(Date),
        }),
      );
    });

    it('releases the claim when a known payment id turns out not to exist and nothing was transmitted', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({ fiatRepublicCustomId: 'DFX-FO-42', fiatRepublicPaymentId: 'pmt_gone' }),
      ]);
      fiatRepublicService.getPayment.mockRejectedValue(new FiatRepublicNotFoundError('missing'));

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(
        { id: 42, fiatRepublicCustomId: 'DFX-FO-42', isTransmittedDate: expect.anything() },
        { fiatRepublicCustomId: null, fiatRepublicPaymentId: null, fiatRepublicError: null },
      );
    });

    it('does not release the claim of a row that was already transmitted', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({
          fiatRepublicCustomId: 'DFX-FO-42',
          fiatRepublicPaymentId: 'pmt_gone',
          isTransmittedDate: new Date(),
        }),
      ]);
      fiatRepublicService.getPayment.mockRejectedValue(new FiatRepublicNotFoundError('missing'));

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
        fiatRepublicError: expect.stringContaining('status error'),
      });
    });

    it('adopts and heals a payment found by its reference', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({ fiatRepublicCustomId: 'DFX-FO-42', fiatRepublicReference: 'DFX-FO-42 Payout' }),
      ]);
      fiatRepublicService.findPaymentByReference.mockResolvedValue(payment() as never);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ fiatRepublicPaymentId: 'pmt_synthetic', isTransmittedDate: expect.any(Date) }),
      );
    });

    it('releases the claim when the reference lookup proves the payment was never created', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({ fiatRepublicCustomId: 'DFX-FO-42', fiatRepublicReference: 'DFX-FO-42 Payout' }),
      ]);
      fiatRepublicService.findPaymentByReference.mockResolvedValue(undefined);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(
        { id: 42, fiatRepublicCustomId: 'DFX-FO-42', isTransmittedDate: expect.anything() },
        { fiatRepublicCustomId: null, fiatRepublicPaymentId: null, fiatRepublicError: null },
      );
    });

    it('never releases the claim of a transmitted row that cannot be found', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({
          fiatRepublicCustomId: 'DFX-FO-42',
          fiatRepublicReference: 'DFX-FO-42 Payout',
          isTransmittedDate: new Date(),
        }),
      ]);
      fiatRepublicService.findPaymentByReference.mockResolvedValue(undefined);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.update).not.toHaveBeenCalled();
    });

    it('falls back to the custom id when no reference was persisted', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ fiatRepublicCustomId: 'DFX-FO-42' })]);
      fiatRepublicService.findPaymentByReference.mockResolvedValue(payment() as never);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatRepublicService.findPaymentByReference).toHaveBeenCalledWith(
        'DFX-FO-42',
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('searches from the creation date when the row never became ready', async () => {
      fiatOutputRepo.find.mockResolvedValue([output({ fiatRepublicCustomId: 'DFX-FO-42', isReadyDate: undefined })]);
      fiatRepublicService.findPaymentByReference.mockResolvedValue(payment() as never);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatRepublicService.findPaymentByReference).toHaveBeenCalled();
    });

    it.each([
      [FiatRepublicPaymentStatus.PROCESSING, { fiatRepublicError: null }],
      [FiatRepublicPaymentStatus.CREATED, { fiatRepublicError: null }],
      [
        FiatRepublicPaymentStatus.COMPLIANCE_REVIEW,
        { fiatRepublicError: 'Fiat Republic payment is in COMPLIANCE_REVIEW' },
      ],
      [FiatRepublicPaymentStatus.MEMBER_REVIEW, { fiatRepublicError: 'Fiat Republic payment is in MEMBER_REVIEW' }],
      [
        FiatRepublicPaymentStatus.AWAITING_APPROVAL,
        { fiatRepublicError: 'Fiat Republic payment is in AWAITING_APPROVAL' },
      ],
      [FiatRepublicPaymentStatus.REJECTED, { fiatRepublicError: 'Fiat Republic payment REJECTED' }],
      [FiatRepublicPaymentStatus.FAILED, { fiatRepublicError: 'Fiat Republic payment FAILED' }],
      [FiatRepublicPaymentStatus.RETURNED, { fiatRepublicError: 'Fiat Republic payment RETURNED' }],
    ])('maps status %s onto the row', async (status, expected) => {
      fiatOutputRepo.find.mockResolvedValue([
        output({
          fiatRepublicCustomId: 'DFX-FO-42',
          fiatRepublicPaymentId: 'pmt_synthetic',
          isTransmittedDate: new Date(),
        }),
      ]);
      fiatRepublicService.getPayment.mockResolvedValue(payment({ status }) as never);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ fiatRepublicPaymentStatus: status, ...expected }),
      );
    });

    it('keeps an existing failure reason instead of overwriting it', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({
          fiatRepublicCustomId: 'DFX-FO-42',
          fiatRepublicPaymentId: 'pmt_synthetic',
          fiatRepublicError: 'original reason',
          isTransmittedDate: new Date(),
        }),
      ]);
      fiatRepublicService.getPayment.mockResolvedValue(payment({ status: FiatRepublicPaymentStatus.FAILED }) as never);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ fiatRepublicError: 'original reason' }),
      );
    });

    it('does not re-stamp an approval date that already exists', async () => {
      const isApprovedDate = new Date('2026-08-02T00:00:00.000Z');
      fiatOutputRepo.find.mockResolvedValue([
        output({
          fiatRepublicCustomId: 'DFX-FO-42',
          fiatRepublicPaymentId: 'pmt_synthetic',
          isTransmittedDate: new Date(),
          isApprovedDate,
          isConfirmedDate: isApprovedDate,
        }),
      ]);
      fiatRepublicService.getPayment.mockResolvedValue(
        payment({ status: FiatRepublicPaymentStatus.COMPLETED }) as never,
      );

      await service.checkFiatRepublicPaymentStatus();

      const [[, data]] = fiatOutputRepo.update.mock.calls;
      expect(data).not.toHaveProperty('isApprovedDate');
      expect(data).not.toHaveProperty('isConfirmedDate');
    });

    it('records an unsupported status as an error instead of crashing the batch', async () => {
      fiatOutputRepo.find.mockResolvedValue([
        output({
          fiatRepublicCustomId: 'DFX-FO-42',
          fiatRepublicPaymentId: 'pmt_synthetic',
          isTransmittedDate: new Date(),
        }),
      ]);
      fiatRepublicService.getPayment.mockResolvedValue(payment({ status: 'Unheard-of' as never }) as never);

      await service.checkFiatRepublicPaymentStatus();

      expect(fiatOutputRepo.update).toHaveBeenCalledWith(42, {
        fiatRepublicError: expect.stringContaining('Unsupported Fiat Republic payment status'),
      });
    });
  });
});
