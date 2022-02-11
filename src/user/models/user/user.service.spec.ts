import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { UserDataService } from '../userData/userData.service';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';
import { UserDataRepository } from '../userData/userData.repository';
import { KycApiService } from 'src/user/services/kyc/kyc-api.service';
import { KycService } from 'src/user/services/kyc/kyc.service';

describe('UserService', () => {
  let service: UserService;

  let userRepo: UserRepository;
  let userDataService: UserDataService;
  let countryService: CountryService;
  let languageService: LanguageService;
  let fiatService: FiatService;
  let userDataRepo: UserDataRepository;
  let kycApiService: KycApiService;
  let kycService: KycService;

  beforeEach(async () => {
    userRepo = createMock<UserRepository>();
    userDataRepo = createMock<UserDataRepository>();
    userDataService = createMock<UserDataService>();
    countryService = createMock<CountryService>();
    languageService = createMock<LanguageService>();
    fiatService = createMock<FiatService>();
    kycApiService = createMock<KycApiService>();
    kycService = createMock<KycService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: userRepo },
        { provide: UserDataService, useValue: userDataService },
        { provide: CountryService, useValue: countryService },
        { provide: LanguageService, useValue: languageService },
        { provide: FiatService, useValue: fiatService },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: KycApiService, useValue: kycApiService },
        { provide: KycService, useValue: kycService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
