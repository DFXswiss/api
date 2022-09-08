import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CountryService } from 'src/shared/models/country/country.service';
import { createDefaultCountry } from 'src/shared/models/country/__mocks__/country.entity.mock';
import { SpiderSyncService } from 'src/user/services/spider/spider-sync.service';
import { SpiderService } from 'src/user/services/spider/spider.service';
import { LinkService } from '../link/link.service';
import { AccountType } from '../user-data/account-type.enum';
import { KycState, KycStatus, UserData } from '../user-data/user-data.entity';
import { UserDataRepository } from '../user-data/user-data.repository';
import { UserDataService } from '../user-data/user-data.service';
import {
  createUserDataFor,
  kycHashFor,
  MockUserData,
  userDataIdFor,
} from '../user-data/__mocks__/user-data.entity.mock';
import { KycUserDataDto } from './dto/kyc-user-data.dto';
import { KycProcessService } from './kyc-process.service';
import { KycInfo, KycService } from './kyc.service';

describe('KycService', () => {
  let service: KycService;

  let userDataService: UserDataService;
  let userDataRepo: UserDataRepository;
  let spiderService: SpiderService;
  let spiderSyncService: SpiderSyncService;
  let countryService: CountryService;
  let kycProcess: KycProcessService;
  let linkService: LinkService;

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
    jest.spyOn(userDataService, 'updateSpiderIfNeeded').mockImplementation((userData, dto) => {
      if (
        userData.kycStatus !== KycStatus.NA &&
        ((dto.phone && userData.phone !== dto.phone) || (dto.mail && userData.mail !== dto.mail))
      ) {
        userData.kycState = KycState.FAILED;
      }
      return Promise.resolve(userData);
    });
    jest.spyOn(kycProcess, 'checkKycProcess').mockImplementation((userData) => {
      return Promise.resolve(userData);
    });
    jest.spyOn(userDataRepo, 'save').mockImplementation((entity) => {
      return Promise.resolve(entity as UserData);
    });
  }

  function createKycInfo(
    kycState: KycState,
    kycStatus: KycStatus,
    kycHash: string,
    kycDataComplete: boolean,
    depositLimit?: number,
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
      depositLimit,
      setupUrl,
      sessionUrl,
    };
  }

  beforeEach(async () => {
    userDataService = createMock<UserDataService>();
    userDataRepo = createMock<UserDataRepository>();
    spiderService = createMock<SpiderService>();
    spiderSyncService = createMock<SpiderSyncService>();
    countryService = createMock<CountryService>();
    kycProcess = createMock<KycProcessService>();
    linkService = createMock<LinkService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: UserDataService, useValue: userDataService },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: SpiderService, useValue: spiderService },
        { provide: SpiderSyncService, useValue: spiderSyncService },
        { provide: CountryService, useValue: countryService },
        { provide: KycProcessService, useValue: kycProcess },
        { provide: LinkService, useValue: linkService },
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
      createKycInfo(KycState.NA, KycStatus.NA, kycHash, false, 90000),
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
        90000,
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
        90000,
        AccountType.PERSONAL,
        't***@test.com',
        '***********89',
      ),
    );
  });

  it('should throw error on getting kyc progress if user is not found with code', async () => {
    setup(MockUserData.CLEAN_DB);

    const kycHash = kycHashFor(MockUserData.EMPTY);

    const testCall = async () => await service.getKycStatus(kycHash);

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
        90000,
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
        90000,
        AccountType.PERSONAL,
        't***@test.com',
        '***********89',
      ),
    );
  });

  it('should throw error on start kyc progress if user is not found with code', async () => {
    setup(MockUserData.CLEAN_DB);

    const kycHash = kycHashFor(MockUserData.EMPTY);

    const testCall = async () => await service.requestKyc(kycHash);

    await expect(testCall).rejects.toThrow(NotFoundException);
    await expect(testCall).rejects.toThrowError('User not found');
  });

  it('should throw error on start kyc progress if user is not found with user id', async () => {
    setup(MockUserData.CLEAN_DB);

    const userDataId = userDataIdFor(MockUserData.EMPTY);

    const testCall = async () => await service.requestKyc('', userDataId);

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
        90000,
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
        90000,
        AccountType.PERSONAL,
        't***@update.com',
        '***********12',
      ),
    );
  });

  it('should throw error on update kyc data if user is not found with code', async () => {
    setup(MockUserData.CLEAN_DB);

    const kycHash = kycHashFor(MockUserData.EMPTY);

    const testCall = async () => await service.updateKycData(kycHash, updatePersonalData);

    await expect(testCall).rejects.toThrow(NotFoundException);
    await expect(testCall).rejects.toThrowError('User not found');
  });

  it('should throw error on update kyc data if user is not found with user id', async () => {
    setup(MockUserData.CLEAN_DB);

    const userDataId = userDataIdFor(MockUserData.EMPTY);

    const testCall = async () => await service.updateKycData('', updatePersonalData, userDataId);

    await expect(testCall).rejects.toThrow(NotFoundException);
    await expect(testCall).rejects.toThrowError('User not found');
  });
});
