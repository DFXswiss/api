import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { createDefaultCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { CountryService } from 'src/shared/models/country/country.service';
import { createDefaultLanguage } from 'src/shared/models/language/__mocks__/language.entity.mock';
import { LanguageDtoMapper } from 'src/shared/models/language/dto/language-dto.mapper';
import { HttpService } from 'src/shared/services/http.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { SpiderSyncService } from 'src/subdomains/generic/user/services/spider/spider-sync.service';
import { SpiderService } from 'src/subdomains/generic/user/services/spider/spider.service';
import { SpiderApiService } from '../../services/spider/spider-api.service';
import { WebhookService } from '../../services/webhook/webhook.service';
import { LinkService } from '../link/link.service';
import {
  MockUserData,
  createUserDataFor,
  kycHashFor,
  userDataIdFor,
} from '../user-data/__mocks__/user-data.entity.mock';
import { AccountType } from '../user-data/account-type.enum';
import { KycState, KycStatus, LimitPeriod, UserData } from '../user-data/user-data.entity';
import { UserDataRepository } from '../user-data/user-data.repository';
import { UserDataService } from '../user-data/user-data.service';
import { TradingLimit } from '../user/dto/user.dto';
import { UserRepository } from '../user/user.repository';
import { WalletRepository } from '../wallet/wallet.repository';
import { WalletService } from '../wallet/wallet.service';
import { KycInfo } from './dto/kyc-info.dto';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { KycProcessService } from './kyc-process.service';
import { KycService } from './kyc.service';

describe('KycService', () => {
  let service: KycService;

  let userDataService: UserDataService;
  let userDataRepo: UserDataRepository;
  let spiderService: SpiderService;
  let spiderSyncService: SpiderSyncService;
  let countryService: CountryService;
  let kycProcess: KycProcessService;
  let linkService: LinkService;
  let userRepo: UserRepository;
  let walletRepo: WalletRepository;
  let httpService: HttpService;
  let walletService: WalletService;
  let webhookService: WebhookService;
  let spiderApiService: SpiderApiService;

  const defaultCountry = createDefaultCountry();

  const updatePersonalData: KycUserDataDto = {
    accountType: AccountType.PERSONAL,
    firstname: 'Test',
    surname: 'TestFamily',
    street: 'A',
    houseNumber: '42',
    location: 'B',
    zip: '43210',
    country: defaultCountry,
    mail: 'test@update.com',
    phone: '+49 123456712',
    organizationName: undefined,
    organizationCountry: undefined,
    organizationHouseNumber: undefined,
    organizationLocation: undefined,
    organizationStreet: undefined,
    organizationZip: undefined,
  };

  function setup(mock: MockUserData) {
    const wantedUserData = createUserDataFor(mock);

    jest.spyOn(userDataRepo, 'findOne').mockResolvedValue(wantedUserData);
    jest.spyOn(kycProcess, 'startKycProcess').mockImplementation((userData) => {
      if (userData.kycStatus === KycStatus.NA) {
        userData.kycStatus = KycStatus.CHATBOT;
      }
      return Promise.resolve(userData);
    });
    jest.spyOn(userDataService, 'getUserDataByUser').mockImplementation(() => {
      return Promise.resolve(wantedUserData);
    });
    jest.spyOn(userDataService, 'getUsersByMail').mockImplementation(() => {
      return Promise.resolve([]);
    });
    jest.spyOn(countryService, 'getCountry').mockImplementation(() => {
      return Promise.resolve(defaultCountry);
    });
    jest.spyOn(userDataService, 'isKnownKycUser').mockResolvedValue(false);
    jest.spyOn(userDataService, 'updateKycData').mockImplementation((userData, dto) => {
      if (
        userData.kycStatus !== KycStatus.NA &&
        ((dto.phone && userData.phone !== dto.phone) || (dto.mail && userData.mail !== dto.mail))
      ) {
        userData.kycState = KycState.FAILED;
      }
      return Promise.resolve(Object.assign(userData, dto));
    });
    jest.spyOn(kycProcess, 'checkKycProcess').mockImplementation((userData) => {
      return Promise.resolve(userData);
    });
    jest.spyOn(userDataRepo, 'save').mockImplementation((entity) => {
      return Promise.resolve(Object.assign(new UserData(), entity));
    });
  }

  function createKycInfo(
    kycState: KycState,
    kycStatus: KycStatus,
    kycHash: string,
    kycDataComplete: boolean,
    tradingLimit?: TradingLimit,
    accountType?: AccountType,
    blankedMail?: string,
    blankedPhone?: string,
    sessionUrl?: string,
    setupUrl?: string,
  ): KycInfo {
    return {
      kycState,
      kycStatus,
      kycHash,
      kycDataComplete,
      accountType,
      blankedMail,
      blankedPhone,
      tradingLimit,
      setupUrl,
      sessionUrl,
      language: LanguageDtoMapper.entityToDto(createDefaultLanguage()),
    };
  }

  beforeEach(async () => {
    userDataService = createMock<UserDataService>();
    userDataRepo = createMock<UserDataRepository>();
    spiderService = createMock<SpiderService>();
    spiderApiService = createMock<SpiderApiService>();
    spiderSyncService = createMock<SpiderSyncService>();
    countryService = createMock<CountryService>();
    kycProcess = createMock<KycProcessService>();
    linkService = createMock<LinkService>();
    userRepo = createMock<UserRepository>();
    walletRepo = createMock<WalletRepository>();
    httpService = createMock<HttpService>();
    walletService = createMock<WalletService>();
    webhookService = createMock<WebhookService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: UserDataService, useValue: userDataService },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: SpiderService, useValue: spiderService },
        { provide: SpiderApiService, useValue: spiderApiService },
        { provide: SpiderSyncService, useValue: spiderSyncService },
        { provide: CountryService, useValue: countryService },
        { provide: KycProcessService, useValue: kycProcess },
        { provide: LinkService, useValue: linkService },
        { provide: UserRepository, useValue: userRepo },
        { provide: WalletRepository, useValue: walletRepo },
        { provide: HttpService, useValue: httpService },
        { provide: WalletService, useValue: walletService },
        { provide: WebhookService, useValue: webhookService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<KycService>(KycService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return current kyc progress for incomplete user', async () => {
    setup(MockUserData.EMPTY);

    const kycHash = kycHashFor(MockUserData.EMPTY);
    await expect(service.getKycStatus(kycHash)).resolves.toStrictEqual(
      createKycInfo(KycState.NA, KycStatus.NA, kycHash, false, {
        limit: Config.defaultDailyTradingLimit,
        period: LimitPeriod.DAY,
      }),
    );
  });

  it('should return current kyc progress for complete user', async () => {
    setup(MockUserData.COMPLETE);

    const kycHash = kycHashFor(MockUserData.COMPLETE);
    await expect(service.getKycStatus(kycHash)).resolves.toStrictEqual(
      createKycInfo(
        KycState.NA,
        KycStatus.NA,
        kycHash,
        true,
        { limit: Config.defaultDailyTradingLimit, period: LimitPeriod.DAY },
        AccountType.PERSONAL,
        't***@test.com',
        '***********89',
      ),
    );
  });

  it('should return current kyc progress for started user', async () => {
    setup(MockUserData.STARTED);

    const kycHash = kycHashFor(MockUserData.STARTED);
    await expect(service.getKycStatus(kycHash)).resolves.toStrictEqual(
      createKycInfo(
        KycState.NA,
        KycStatus.CHATBOT,
        kycHash,
        true,
        { limit: Config.defaultDailyTradingLimit, period: LimitPeriod.DAY },
        AccountType.PERSONAL,
        't***@test.com',
        '***********89',
      ),
    );
  });

  it('should throw error on getting kyc progress if user is not found with code', async () => {
    setup(MockUserData.CLEAN_DB);

    const kycHash = kycHashFor(MockUserData.EMPTY);

    const testCall = async () => service.getKycStatus(kycHash);

    await expect(testCall).rejects.toThrow(NotFoundException);
    await expect(testCall).rejects.toThrowError('User not found');
  });

  it('should start kyc progress with code', async () => {
    setup(MockUserData.COMPLETE);

    const kycHash = kycHashFor(MockUserData.COMPLETE);
    await expect(service.requestKyc(kycHash)).resolves.toStrictEqual(
      createKycInfo(
        KycState.NA,
        KycStatus.CHATBOT,
        kycHash,
        true,
        { limit: Config.defaultDailyTradingLimit, period: LimitPeriod.DAY },
        AccountType.PERSONAL,
        't***@test.com',
        '***********89',
      ),
    );
  });

  it('should start kyc progress with empty code and user id', async () => {
    setup(MockUserData.COMPLETE);

    const kycHash = kycHashFor(MockUserData.COMPLETE);
    // in our test setup: user id and user data id are equal
    const userDataId = userDataIdFor(MockUserData.COMPLETE);
    await expect(service.requestKyc('', userDataId)).resolves.toStrictEqual(
      createKycInfo(
        KycState.NA,
        KycStatus.CHATBOT,
        kycHash,
        true,
        { limit: Config.defaultDailyTradingLimit, period: LimitPeriod.DAY },
        AccountType.PERSONAL,
        't***@test.com',
        '***********89',
      ),
    );
  });

  it('should throw error on start kyc progress if user is not found with code', async () => {
    setup(MockUserData.CLEAN_DB);

    const kycHash = kycHashFor(MockUserData.EMPTY);

    const testCall = async () => service.requestKyc(kycHash);

    await expect(testCall).rejects.toThrow(NotFoundException);
    await expect(testCall).rejects.toThrowError('User not found');
  });

  it('should throw error on start kyc progress if user is not found with user id', async () => {
    setup(MockUserData.CLEAN_DB);

    const userDataId = userDataIdFor(MockUserData.EMPTY);

    const testCall = async () => service.requestKyc('', userDataId);

    await expect(testCall).rejects.toThrow(NotFoundException);
    await expect(testCall).rejects.toThrowError('User not found');
  });

  it('should update kyc data with code', async () => {
    setup(MockUserData.EMPTY);

    const kycHash = kycHashFor(MockUserData.EMPTY);
    await expect(service.updateKycData(kycHash, updatePersonalData)).resolves.toStrictEqual(
      createKycInfo(
        KycState.NA,
        KycStatus.NA,
        kycHash,
        true,
        { limit: Config.defaultDailyTradingLimit, period: LimitPeriod.DAY },
        AccountType.PERSONAL,
        't***@update.com',
        '***********12',
      ),
    );
  });

  it('should update kyc data with empty code and user id', async () => {
    setup(MockUserData.EMPTY);

    const kycHash = kycHashFor(MockUserData.EMPTY);
    const userDataId = userDataIdFor(MockUserData.EMPTY);
    await expect(service.updateKycData('', updatePersonalData, userDataId)).resolves.toStrictEqual(
      createKycInfo(
        KycState.NA,
        KycStatus.NA,
        kycHash,
        true,
        { limit: Config.defaultDailyTradingLimit, period: LimitPeriod.DAY },
        AccountType.PERSONAL,
        't***@update.com',
        '***********12',
      ),
    );
  });

  it('should throw error on update kyc data if user is not found with code', async () => {
    setup(MockUserData.CLEAN_DB);

    const kycHash = kycHashFor(MockUserData.EMPTY);

    const testCall = async () => service.updateKycData(kycHash, updatePersonalData);

    await expect(testCall).rejects.toThrow(NotFoundException);
    await expect(testCall).rejects.toThrowError('User not found');
  });

  it('should throw error on update kyc data if user is not found with user id', async () => {
    setup(MockUserData.CLEAN_DB);

    const userDataId = userDataIdFor(MockUserData.EMPTY);

    const testCall = async () => service.updateKycData('', updatePersonalData, userDataId);

    await expect(testCall).rejects.toThrow(NotFoundException);
    await expect(testCall).rejects.toThrowError('User not found');
  });
});
