import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { CountryService } from 'src/shared/models/country/country.service';
import { HttpService } from 'src/shared/services/http.service';
import { KycDocumentService } from 'src/subdomains/generic/kyc/services/integration/kyc-document.service';
import { UserDataRepository } from '../../user-data/user-data.repository';
import { UserDataService } from '../../user-data/user-data.service';
import { UserRepository } from '../../user/user.repository';
import { WalletRepository } from '../../wallet/wallet.repository';
import { KycService } from '../kyc.service';

describe('KycService', () => {
  let service: KycService;
  let userRepo: jest.Mocked<Partial<UserRepository>>;
  let walletRepo: jest.Mocked<Partial<WalletRepository>>;
  let http: jest.Mocked<Partial<HttpService>>;

  beforeEach(() => {
    userRepo = { findOne: jest.fn() };
    walletRepo = { findOneBy: jest.fn() };
    http = { get: jest.fn() };

    service = new KycService(
      createMock<UserDataService>(),
      createMock<UserDataRepository>(),
      userRepo as unknown as UserRepository,
      walletRepo as unknown as WalletRepository,
      createMock<CountryService>(),
      http as unknown as HttpService,
      createMock<KycDocumentService>(),
    );
  });

  describe('transferKycData', () => {
    const dfxUser = { id: 1, address: '0xme', userData: { id: 10, kycLevel: 50 } };

    beforeEach(() => {
      walletRepo.findOneBy.mockResolvedValue({
        name: 'w',
        isKycClient: true,
        apiUrl: 'https://x',
        apiKey: 'k',
      } as never);
      userRepo.findOne.mockResolvedValue(dfxUser as never);
    });

    // `result` is the unvalidated body of a third-party HTTP response. Without a kycId the lookup
    // loses its only condition and returns an arbitrary user — whose account would then be merged
    // with the caller's. The `!externalUser` check cannot catch it, because a row was found.
    it.each([{}, { kycId: undefined }, { kycId: null }, { kycId: '' }])(
      'does not query for the external user when the response is %p',
      async (response) => {
        http.get.mockResolvedValue(response as never);

        await expect(service.transferKycData(1, { walletName: 'w' } as never)).rejects.toBeInstanceOf(
          NotFoundException,
        );

        // one call to load the DFX user, and none for the external lookup
        expect(userRepo.findOne).toHaveBeenCalledTimes(1);
      },
    );

    it('still looks up the external user when a kycId is returned', async () => {
      http.get.mockResolvedValue({ kycId: '0xthem' } as never);
      userRepo.findOne.mockResolvedValueOnce(dfxUser as never).mockResolvedValueOnce(undefined as never);

      await expect(service.transferKycData(1, { walletName: 'w' } as never)).rejects.toBeInstanceOf(NotFoundException);

      expect(userRepo.findOne).toHaveBeenLastCalledWith(expect.objectContaining({ where: { address: '0xthem' } }));
    });
  });
});
