import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import {
  FiatRepublicAccountStatus,
  FiatRepublicOwnerType,
  FiatRepublicPerson,
} from 'src/integration/bank/dto/fiat-republic.dto';
import { FiatRepublicEndUserService } from 'src/integration/bank/services/fiat-republic-end-user.service';
import { FiatRepublicNotCreatedError, FiatRepublicService } from 'src/integration/bank/services/fiat-republic.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { IbanBankName } from '../../../bank/dto/bank.dto';
import { VibanAccountHolder } from '../viban-account-holder.enum';
import { VibanNotCreatedError } from '../viban-provider.interface';
import { FiatRepublicVibanProvider } from '../fiat-republic-viban.provider';

const PERSON: FiatRepublicPerson = {
  firstName: 'Synthetic',
  lastName: 'Person',
  email: 'synthetic@example.com',
  dob: '1990-01-01',
  address: { line1: 'Street 1', city: 'City', postalCode: '0000', country: 'DE' },
};

const REQUEST = { userDataId: 42, person: PERSON, ipAddress: '203.0.113.1', label: 'DFX EUR 42' };

function account(overrides = {}) {
  return {
    id: 'vac_synthetic',
    masterFiatAccountId: 'fac_synthetic',
    status: FiatRepublicAccountStatus.ACTIVE,
    currency: 'EUR',
    owner: { type: FiatRepublicOwnerType.END_USER, id: 'eus_synthetic' },
    bankDetails: { iban: 'DE89370400440532013000' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('FiatRepublicVibanProvider', () => {
  let provider: FiatRepublicVibanProvider;
  let fiatRepublicService: DeepMocked<FiatRepublicService>;
  let endUserService: DeepMocked<FiatRepublicEndUserService>;

  beforeEach(async () => {
    fiatRepublicService = createMock<FiatRepublicService>();
    endUserService = createMock<FiatRepublicEndUserService>();

    jest.spyOn(fiatRepublicService, 'isFrontendEnabled').mockReturnValue(true);
    endUserService.getOrCreateEndUser.mockResolvedValue('eus_synthetic');
    jest.spyOn(Util, 'delay').mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        FiatRepublicVibanProvider,
        { provide: FiatRepublicService, useValue: fiatRepublicService },
        { provide: FiatRepublicEndUserService, useValue: endUserService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    provider = module.get<FiatRepublicVibanProvider>(FiatRepublicVibanProvider);

    Config.bank.fiatRepublic.masterFiatAccountId = 'fac_synthetic';
    Config.bank.fiatRepublic.ibanCountry = 'DE';
  });

  afterEach(() => {
    Config.bank.fiatRepublic.masterFiatAccountId = undefined;
    jest.restoreAllMocks();
  });

  it('describes itself as a customer-held EUR provider', () => {
    expect(provider.bankName).toBe(IbanBankName.FIAT_REPUBLIC);
    expect(provider.currencies).toEqual(['EUR']);
    expect(provider.accountHolder).toBe(VibanAccountHolder.CUSTOMER);
  });

  describe('isAvailable', () => {
    it('is available with the frontend stage released and a master account configured', () => {
      expect(provider.isAvailable()).toBe(true);
    });

    it('is unavailable while the frontend stage is not released', () => {
      jest.spyOn(fiatRepublicService, 'isFrontendEnabled').mockReturnValue(false);

      expect(provider.isAvailable()).toBe(false);
    });

    it('is unavailable without a master fiat account', () => {
      Config.bank.fiatRepublic.masterFiatAccountId = undefined;

      expect(provider.isAvailable()).toBe(false);
    });
  });

  it('refuses the generic issuance entry point outright', async () => {
    await expect(provider.reserveViban()).rejects.toThrow('requires an end user');
  });

  describe('reserveVibanForUser', () => {
    it('refuses while unavailable, without touching the end user', async () => {
      jest.spyOn(fiatRepublicService, 'isFrontendEnabled').mockReturnValue(false);

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(endUserService.getOrCreateEndUser).not.toHaveBeenCalled();
    });

    it('creates the end user first, then the virtual account under the master account', async () => {
      fiatRepublicService.createVirtualAccount.mockResolvedValue(account() as never);

      await expect(provider.reserveVibanForUser(REQUEST)).resolves.toEqual({
        iban: 'DE89370400440532013000',
        providerAccountRef: 'vac_synthetic',
      });
      expect(endUserService.getOrCreateEndUser).toHaveBeenCalledWith(42, PERSON, '203.0.113.1');
      expect(fiatRepublicService.createVirtualAccount).toHaveBeenCalledWith(
        {
          masterFiatAccountId: 'fac_synthetic',
          ibanCountry: 'DE',
          endUserId: 'eus_synthetic',
          label: 'DFX EUR 42',
        },
        'dfx-fr-viban-42',
      );
    });

    it('propagates a failing end user creation without creating an account', async () => {
      endUserService.getOrCreateEndUser.mockRejectedValue(new ServiceUnavailableException('nope'));

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fiatRepublicService.createVirtualAccount).not.toHaveBeenCalled();
    });

    it('reports a deterministic rejection as not-created so the caller can release its claim', async () => {
      fiatRepublicService.createVirtualAccount.mockRejectedValue(new FiatRepublicNotCreatedError('rejected'));

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toBeInstanceOf(VibanNotCreatedError);
      expect(fiatRepublicService.listVirtualAccountsByEndUser).not.toHaveBeenCalled();
    });

    it('recovers the account from the listing after an ambiguous create failure', async () => {
      fiatRepublicService.createVirtualAccount.mockRejectedValue(new Error('gateway timeout'));
      fiatRepublicService.listVirtualAccountsByEndUser.mockResolvedValue([account()] as never);

      await expect(provider.reserveVibanForUser(REQUEST)).resolves.toMatchObject({
        providerAccountRef: 'vac_synthetic',
      });
      expect(fiatRepublicService.createVirtualAccount).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['an empty listing', []],
      ['a null listing', undefined],
      ['an account of another master account', [account({ masterFiatAccountId: 'fac_other' })]],
      ['a closed account', [account({ status: FiatRepublicAccountStatus.CLOSED })]],
      ['a failed activation', [account({ status: FiatRepublicAccountStatus.ACTIVATION_FAILED })]],
      ['an account without an id', [account({ id: undefined })]],
      ['two candidates', [account(), account({ id: 'vac_second' })]],
    ])('fails closed and never re-creates on %s', async (_name, listing) => {
      fiatRepublicService.createVirtualAccount.mockRejectedValue(new Error('gateway timeout'));
      fiatRepublicService.listVirtualAccountsByEndUser.mockResolvedValue(listing as never);

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toThrow('creation failed');
      expect(fiatRepublicService.createVirtualAccount).toHaveBeenCalledTimes(1);
    });

    it('fails closed on a non-Error create failure with nothing to recover', async () => {
      fiatRepublicService.createVirtualAccount.mockRejectedValue('not an error');
      fiatRepublicService.listVirtualAccountsByEndUser.mockResolvedValue([] as never);

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toThrow('creation failed');
    });

    it('fails closed on a non-Error recovery listing failure', async () => {
      fiatRepublicService.createVirtualAccount.mockRejectedValue(new Error('gateway timeout'));
      fiatRepublicService.listVirtualAccountsByEndUser.mockRejectedValue('not an error');

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toThrow('creation failed');
    });

    it('fails closed when the recovery listing itself fails', async () => {
      fiatRepublicService.createVirtualAccount.mockRejectedValue(new Error('gateway timeout'));
      fiatRepublicService.listVirtualAccountsByEndUser.mockRejectedValue(new Error('listing down'));

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toThrow('creation failed');
    });

    it('polls until the bank details are assigned', async () => {
      fiatRepublicService.createVirtualAccount.mockResolvedValue(
        account({ status: FiatRepublicAccountStatus.CREATED, bankDetails: null }) as never,
      );
      fiatRepublicService.getVirtualAccount
        .mockResolvedValueOnce(account({ status: FiatRepublicAccountStatus.CREATED, bankDetails: null }) as never)
        .mockResolvedValueOnce(account() as never);

      await expect(provider.reserveVibanForUser(REQUEST)).resolves.toMatchObject({
        iban: 'DE89370400440532013000',
      });
      expect(fiatRepublicService.getVirtualAccount).toHaveBeenCalledTimes(2);
    });

    it.each([FiatRepublicAccountStatus.CLOSED, FiatRepublicAccountStatus.ACTIVATION_FAILED])(
      'refuses an account that reached %s',
      async (status) => {
        fiatRepublicService.createVirtualAccount.mockResolvedValue(account({ status, bankDetails: null }) as never);

        await expect(provider.reserveVibanForUser(REQUEST)).rejects.toThrow('could not be activated');
      },
    );

    it('gives up without deleting the account when no IBAN arrives in time', async () => {
      fiatRepublicService.createVirtualAccount.mockResolvedValue(
        account({ status: FiatRepublicAccountStatus.CREATED, bankDetails: null }) as never,
      );
      fiatRepublicService.getVirtualAccount.mockResolvedValue(
        account({ status: FiatRepublicAccountStatus.CREATED, bankDetails: null }) as never,
      );

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toThrow('not ready');
    });

    it('surfaces a non-Error activation poll failure', async () => {
      fiatRepublicService.createVirtualAccount.mockResolvedValue(
        account({ status: FiatRepublicAccountStatus.CREATED, bankDetails: null }) as never,
      );
      fiatRepublicService.getVirtualAccount.mockRejectedValue('not an error');

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toThrow('activation failed');
    });

    it('surfaces a failing activation poll', async () => {
      fiatRepublicService.createVirtualAccount.mockResolvedValue(
        account({ status: FiatRepublicAccountStatus.CREATED, bankDetails: null }) as never,
      );
      fiatRepublicService.getVirtualAccount.mockRejectedValue(new Error('gateway timeout'));

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toThrow('activation failed');
    });

    it.each([
      ['a different end user', account({ owner: { type: FiatRepublicOwnerType.END_USER, id: 'eus_other' } })],
      ['a different master account', account({ masterFiatAccountId: 'fac_other' })],
      ['a missing owner', account({ owner: undefined })],
    ])('refuses to adopt an account bound to %s', async (_name, response) => {
      fiatRepublicService.createVirtualAccount.mockResolvedValue(response as never);

      await expect(provider.reserveVibanForUser(REQUEST)).rejects.toThrow('binding mismatch');
    });
  });
});
