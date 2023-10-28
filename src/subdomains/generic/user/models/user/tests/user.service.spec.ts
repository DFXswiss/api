import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { DfiTaxService } from 'src/integration/blockchain/ain/services/dfi-tax.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { ApiKeyService } from 'src/shared/services/api-key.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { KycService } from '../../kyc/kyc.service';
import { UserDataRepository } from '../../user-data/user-data.repository';
import { UserDataService } from '../../user-data/user-data.service';
import { WalletService } from '../../wallet/wallet.service';
import { UserRepository } from '../user.repository';
import { UserService } from '../user.service';

describe('UserService', () => {
  let service: UserService;

  let userRepo: UserRepository;
  let userDataRepo: UserDataRepository;
  let userDataService: UserDataService;
  let kycService: KycService;
  let walletService: WalletService;
  let dfiTaxService: DfiTaxService;
  let geoLocationService: GeoLocationService;
  let countryService: CountryService;
  let cryptoService: CryptoService;
  let apiKeyService: ApiKeyService;
  let feeService: FeeService;

  beforeEach(async () => {
    userRepo = createMock<UserRepository>();
    userDataRepo = createMock<UserDataRepository>();
    userDataService = createMock<UserDataService>();
    kycService = createMock<KycService>();
    walletService = createMock<WalletService>();
    dfiTaxService = createMock<DfiTaxService>();
    geoLocationService = createMock<GeoLocationService>();
    countryService = createMock<CountryService>();
    cryptoService = createMock<CryptoService>();
    apiKeyService = createMock<ApiKeyService>();
    feeService = createMock<FeeService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: userRepo },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: UserDataService, useValue: userDataService },
        { provide: KycService, useValue: kycService },
        { provide: WalletService, useValue: walletService },
        { provide: DfiTaxService, useValue: dfiTaxService },
        { provide: GeoLocationService, useValue: geoLocationService },
        { provide: CountryService, useValue: countryService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: ApiKeyService, useValue: apiKeyService },
        { provide: FeeService, useValue: feeService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
