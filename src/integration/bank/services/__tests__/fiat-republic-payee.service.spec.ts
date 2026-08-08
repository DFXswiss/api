import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { DataSource, EntityManager } from 'typeorm';
import {
  FiatRepublicAddress,
  FiatRepublicMatchLevel,
  FiatRepublicPayeeStatus,
  FiatRepublicPayeeType,
  FiatRepublicVerificationStatus,
} from '../../dto/fiat-republic.dto';
import { FiatRepublicPayee } from '../../entities/fiat-republic-payee.entity';
import { FiatRepublicPayeeRepository } from '../../repositories/fiat-republic-payee.repository';
import { FiatRepublicPayeeService } from '../fiat-republic-payee.service';
import { FiatRepublicNotCreatedError, FiatRepublicService } from '../fiat-republic.service';

const ADDRESS: FiatRepublicAddress = { line1: 'Street 1', city: 'City', postalCode: '0000', country: 'DE' };

function request(overrides = {}) {
  return {
    endUserId: 'eus_synthetic',
    name: 'Synthetic Person',
    iban: 'de89 3704 0044 0532 0130 00',
    bic: 'SYNTDEFF',
    address: ADDRESS,
    ...overrides,
  };
}

function payeeRow(overrides: Partial<FiatRepublicPayee> = {}): FiatRepublicPayee {
  return Object.assign(new FiatRepublicPayee(), {
    id: 3,
    endUserId: 'eus_synthetic',
    iban: 'DE89370400440532013000',
    name: 'Synthetic Person',
    payeeId: null,
    status: null,
    ...overrides,
  });
}

function payeeResponse(overrides = {}) {
  return {
    id: 'pye_synthetic',
    owner: { type: 'END_USER', id: 'eus_synthetic' },
    type: FiatRepublicPayeeType.PERSON,
    name: 'Synthetic Person',
    currency: 'EUR',
    address: ADDRESS,
    bankDetails: { iban: 'DE89370400440532013000' },
    status: FiatRepublicPayeeStatus.ACTIVE,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    id: 'pvn_synthetic',
    payeeId: 'pye_synthetic',
    assignedToId: null,
    status: FiatRepublicVerificationStatus.ACCEPTED,
    type: 'VERIFICATION_OF_PAYEE',
    matchResult: { matchLevel: FiatRepublicMatchLevel.MATCH, description: null, accountHolder: null },
    ...overrides,
  };
}

describe('FiatRepublicPayeeService', () => {
  let service: FiatRepublicPayeeService;
  let fiatRepublicService: DeepMocked<FiatRepublicService>;
  let payeeRepo: DeepMocked<FiatRepublicPayeeRepository>;
  let dataSource: DeepMocked<DataSource>;
  let manager: DeepMocked<EntityManager>;
  let stored: FiatRepublicPayee;

  beforeEach(async () => {
    fiatRepublicService = createMock<FiatRepublicService>();
    payeeRepo = createMock<FiatRepublicPayeeRepository>();
    manager = createMock<EntityManager>();
    dataSource = createMock<DataSource>();

    stored = payeeRow();
    manager.query.mockResolvedValue([]);
    manager.findOne.mockImplementation(async () => stored);
    dataSource.transaction.mockImplementation(async (cb: never) => (cb as (m: EntityManager) => unknown)(manager));

    jest.spyOn(fiatRepublicService, 'isPayoutEnabled').mockReturnValue(true);
    jest.spyOn(Util, 'delay').mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatRepublicPayeeService,
        { provide: FiatRepublicService, useValue: fiatRepublicService },
        { provide: FiatRepublicPayeeRepository, useValue: payeeRepo },
        { provide: DataSource, useValue: dataSource },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<FiatRepublicPayeeService>(FiatRepublicPayeeService);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('getOrCreatePayee', () => {
    it('refuses while the payout stage is not released', async () => {
      jest.spyOn(fiatRepublicService, 'isPayoutEnabled').mockReturnValue(false);

      await expect(service.getOrCreatePayee(request())).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('normalises the IBAN and trims the name before claiming', async () => {
      fiatRepublicService.createPayee.mockResolvedValue(payeeResponse() as never);

      await service.getOrCreatePayee(request({ name: '  Synthetic Person  ' }));

      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT DO NOTHING'), [
        'eus_synthetic',
        'DE89370400440532013000',
        'Synthetic Person',
      ]);
    });

    it('claims under an advisory lock keyed on the full identity triple', async () => {
      fiatRepublicService.createPayee.mockResolvedValue(payeeResponse() as never);

      await service.getOrCreatePayee(request());

      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [
        'fiat-republic-payee',
        'eus_synthetic:DE89370400440532013000:Synthetic Person',
      ]);
    });

    it('creates the payee with EUR bank details and returns its id', async () => {
      fiatRepublicService.createPayee.mockResolvedValue(payeeResponse() as never);

      await expect(service.getOrCreatePayee(request())).resolves.toBe('pye_synthetic');
      expect(fiatRepublicService.createPayee).toHaveBeenCalledWith(
        {
          endUserId: 'eus_synthetic',
          type: FiatRepublicPayeeType.PERSON,
          name: 'Synthetic Person',
          currency: 'EUR',
          address: ADDRESS,
          bankDetails: { iban: 'DE89370400440532013000', bic: 'SYNTDEFF' },
        },
        // Derived from the claim row, so a retry after an ambiguous failure resolves to the
        // original payee instead of creating a second one.
        'dfx-fr-payee-3',
      );
      expect(payeeRepo.update).toHaveBeenCalledWith(3, {
        payeeId: 'pye_synthetic',
        status: FiatRepublicPayeeStatus.ACTIVE,
      });
    });

    it('omits the BIC when the caller has none', async () => {
      fiatRepublicService.createPayee.mockResolvedValue(payeeResponse() as never);

      await service.getOrCreatePayee(request({ bic: undefined }));

      expect(fiatRepublicService.createPayee).toHaveBeenCalledWith(
        expect.objectContaining({ bankDetails: { iban: 'DE89370400440532013000' } }),
        'dfx-fr-payee-3',
      );
    });

    it('honours an explicit business payee type', async () => {
      fiatRepublicService.createPayee.mockResolvedValue(payeeResponse() as never);

      await service.getOrCreatePayee(request({ type: FiatRepublicPayeeType.BUSINESS }));

      expect(fiatRepublicService.createPayee).toHaveBeenCalledWith(
        expect.objectContaining({ type: FiatRepublicPayeeType.BUSINESS }),
        'dfx-fr-payee-3',
      );
    });

    it('reuses an already created payee instead of creating a second one', async () => {
      stored = payeeRow({ payeeId: 'pye_existing', status: FiatRepublicPayeeStatus.ACTIVE });
      fiatRepublicService.getPayee.mockResolvedValue(payeeResponse({ id: 'pye_existing' }) as never);

      await expect(service.getOrCreatePayee(request())).resolves.toBe('pye_existing');
      expect(fiatRepublicService.createPayee).not.toHaveBeenCalled();
    });

    it('drops the claim row on a deterministic rejection', async () => {
      fiatRepublicService.createPayee.mockRejectedValue(new FiatRepublicNotCreatedError('rejected'));

      await expect(service.getOrCreatePayee(request())).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(payeeRepo.delete).toHaveBeenCalledWith(3);
    });

    it('keeps the claim row on an ambiguous failure so the next attempt reuses it', async () => {
      fiatRepublicService.createPayee.mockRejectedValue(new Error('gateway timeout'));

      await expect(service.getOrCreatePayee(request())).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(payeeRepo.delete).not.toHaveBeenCalled();
    });

    it('retries an ambiguous failure under the same idempotency key, never creating a second payee', async () => {
      fiatRepublicService.createPayee.mockRejectedValueOnce(new Error('gateway timeout'));

      await expect(service.getOrCreatePayee(request())).rejects.toBeInstanceOf(ServiceUnavailableException);

      fiatRepublicService.createPayee.mockResolvedValue(payeeResponse() as never);
      await expect(service.getOrCreatePayee(request())).resolves.toBe('pye_synthetic');

      const keys = fiatRepublicService.createPayee.mock.calls.map(([, key]) => key);
      expect(keys).toEqual(['dfx-fr-payee-3', 'dfx-fr-payee-3']);
    });

    it('keeps the claim row on a non-Error create failure', async () => {
      fiatRepublicService.createPayee.mockRejectedValue('not an error');

      await expect(service.getOrCreatePayee(request())).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(payeeRepo.delete).not.toHaveBeenCalled();
    });

    it('throws when the claim row cannot be read back', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(service.getOrCreatePayee(request())).rejects.toThrow('claim missing after insert');
    });

    it('polls until the payee becomes active', async () => {
      fiatRepublicService.createPayee.mockResolvedValue(
        payeeResponse({ status: FiatRepublicPayeeStatus.CREATED }) as never,
      );
      fiatRepublicService.getPayee
        .mockResolvedValueOnce(payeeResponse({ status: FiatRepublicPayeeStatus.PROCESSING }) as never)
        .mockResolvedValueOnce(payeeResponse({ status: FiatRepublicPayeeStatus.ACTIVE }) as never);

      await expect(service.getOrCreatePayee(request())).resolves.toBe('pye_synthetic');
      expect(fiatRepublicService.getPayee).toHaveBeenCalledTimes(2);
    });

    it.each([FiatRepublicPayeeStatus.REJECTED, FiatRepublicPayeeStatus.DELETED])(
      'refuses a payee that reached %s',
      async (status) => {
        fiatRepublicService.createPayee.mockResolvedValue(payeeResponse({ status }) as never);

        await expect(service.getOrCreatePayee(request())).rejects.toThrow('not usable');
        expect(payeeRepo.update).toHaveBeenCalledWith(3, { status });
      },
    );

    it('gives up after the poll budget without losing the claim row', async () => {
      fiatRepublicService.createPayee.mockResolvedValue(
        payeeResponse({ status: FiatRepublicPayeeStatus.CREATED }) as never,
      );
      fiatRepublicService.getPayee.mockResolvedValue(
        payeeResponse({ status: FiatRepublicPayeeStatus.PROCESSING }) as never,
      );

      await expect(service.getOrCreatePayee(request())).rejects.toThrow('not active yet');
      expect(payeeRepo.delete).not.toHaveBeenCalled();
      expect(payeeRepo.update).toHaveBeenLastCalledWith(3, { status: FiatRepublicPayeeStatus.PROCESSING });
    });

    it('surfaces a non-Error status poll failure', async () => {
      fiatRepublicService.createPayee.mockResolvedValue(
        payeeResponse({ status: FiatRepublicPayeeStatus.CREATED }) as never,
      );
      fiatRepublicService.getPayee.mockRejectedValue('not an error');

      await expect(service.getOrCreatePayee(request())).rejects.toThrow('could not be resolved');
    });

    it('surfaces a failing status poll instead of assuming the payee is fine', async () => {
      fiatRepublicService.createPayee.mockResolvedValue(
        payeeResponse({ status: FiatRepublicPayeeStatus.CREATED }) as never,
      );
      fiatRepublicService.getPayee.mockRejectedValue(new Error('gateway timeout'));

      await expect(service.getOrCreatePayee(request())).rejects.toThrow('could not be resolved');
    });
  });

  describe('createVerification', () => {
    it('returns an already accepted verification with its match level', async () => {
      fiatRepublicService.verifyPayee.mockResolvedValue(verification() as never);

      await expect(service.createVerification('pye_synthetic')).resolves.toEqual({
        verificationId: 'pvn_synthetic',
        matchLevel: FiatRepublicMatchLevel.MATCH,
      });
      expect(fiatRepublicService.reviewPayeeVerification).not.toHaveBeenCalled();
    });

    it('accepts an exempt verification without a review', async () => {
      fiatRepublicService.verifyPayee.mockResolvedValue(
        verification({ status: FiatRepublicVerificationStatus.EXEMPT }) as never,
      );

      await expect(service.createVerification('pye_synthetic')).resolves.toMatchObject({
        verificationId: 'pvn_synthetic',
      });
      expect(fiatRepublicService.reviewPayeeVerification).not.toHaveBeenCalled();
    });

    it('reviews and accepts a close match, reporting the observed level', async () => {
      fiatRepublicService.verifyPayee.mockResolvedValue(
        verification({
          status: FiatRepublicVerificationStatus.PENDING_CUSTOMER_REVIEW,
          matchResult: { matchLevel: FiatRepublicMatchLevel.CLOSE_MATCH, description: null, accountHolder: null },
        }) as never,
      );
      fiatRepublicService.reviewPayeeVerification.mockResolvedValue(verification() as never);

      await expect(service.createVerification('pye_synthetic')).resolves.toEqual({
        verificationId: 'pvn_synthetic',
        matchLevel: FiatRepublicMatchLevel.CLOSE_MATCH,
      });
      expect(fiatRepublicService.reviewPayeeVerification).toHaveBeenCalledWith('pvn_synthetic', true);
    });

    it('defaults a missing match result to NO_MATCH rather than claiming a match', async () => {
      fiatRepublicService.verifyPayee.mockResolvedValue(verification({ matchResult: undefined }) as never);

      await expect(service.createVerification('pye_synthetic')).resolves.toMatchObject({
        matchLevel: FiatRepublicMatchLevel.NO_MATCH,
      });
    });

    it('fails closed when the beneficiary bank cannot answer at all', async () => {
      fiatRepublicService.verifyPayee.mockRejectedValue(new Error("Payee couldn't be verified"));

      await expect(service.createVerification('pye_synthetic')).rejects.toThrow('verification failed');
    });

    it('fails closed on a non-Error verification failure', async () => {
      fiatRepublicService.verifyPayee.mockRejectedValue('not an error');

      await expect(service.createVerification('pye_synthetic')).rejects.toThrow('verification failed');
    });

    it.each([
      FiatRepublicVerificationStatus.ASSIGNED,
      FiatRepublicVerificationStatus.EXPIRED,
      FiatRepublicVerificationStatus.DECLINED,
    ])('refuses an unusable verification status %s', async (status) => {
      fiatRepublicService.verifyPayee.mockResolvedValue(verification({ status }) as never);

      await expect(service.createVerification('pye_synthetic')).rejects.toThrow('not usable');
      expect(fiatRepublicService.reviewPayeeVerification).not.toHaveBeenCalled();
    });

    it('refuses when the review does not end in an accepted state', async () => {
      fiatRepublicService.verifyPayee.mockResolvedValue(
        verification({ status: FiatRepublicVerificationStatus.PENDING_CUSTOMER_REVIEW }) as never,
      );
      fiatRepublicService.reviewPayeeVerification.mockResolvedValue(
        verification({ status: FiatRepublicVerificationStatus.EXPIRED }) as never,
      );

      await expect(service.createVerification('pye_synthetic')).rejects.toThrow('not usable');
    });
  });
});
