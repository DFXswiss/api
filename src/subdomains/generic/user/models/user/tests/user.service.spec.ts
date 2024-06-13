import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { GeoLocationService } from 'src/integration/geolocation/geo-location.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
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
  let walletService: WalletService;
  let geoLocationService: GeoLocationService;
  let countryService: CountryService;
  let cryptoService: CryptoService;
  let feeService: FeeService;
  let languageService: LanguageService;

  beforeEach(async () => {
    userRepo = createMock<UserRepository>();
    userDataRepo = createMock<UserDataRepository>();
    userDataService = createMock<UserDataService>();
    walletService = createMock<WalletService>();
    geoLocationService = createMock<GeoLocationService>();
    countryService = createMock<CountryService>();
    cryptoService = createMock<CryptoService>();
    feeService = createMock<FeeService>();
    languageService = createMock<LanguageService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: userRepo },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: UserDataService, useValue: userDataService },
        { provide: WalletService, useValue: walletService },
        { provide: GeoLocationService, useValue: geoLocationService },
        { provide: CountryService, useValue: countryService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: FeeService, useValue: feeService },
        { provide: LanguageService, useValue: languageService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
