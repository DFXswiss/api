import { createMock } from "@golevelup/ts-jest";
import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Country } from "src/shared/models/country/country.entity";
import { CountryService } from "src/shared/models/country/country.service";
import { TestUtil } from "src/shared/test.util";
import { SpiderSyncService } from "src/user/services/spider/spider-sync.service";
import { SpiderService } from "src/user/services/spider/spider.service";
import { AccountType } from "../user-data/account-type.enum";
import { KycState, KycStatus, UserData } from "../user-data/user-data.entity";
import { UserDataRepository } from "../user-data/user-data.repository";
import { UserDataService } from "../user-data/user-data.service";
import { KycUserDataDto } from "./dto/kyc-user-data.dto";
import { KycProcessService } from "./kyc-process.service";
import { KycInfo, KycService } from "./kyc.service"

enum MockData {
  CLEAN_DB,
  EMPTY,
  COMPLETE,
  STARTED,
}

describe('KycService', () => {
  let service: KycService

  let userDataService: UserDataService
  let userDataRepo: UserDataRepository
  let spiderService: SpiderService
  let spiderSyncService: SpiderSyncService
  let countryService: CountryService
  let kycProcess: KycProcessService

  const testCountry: Country = {
    id: 1,
    symbol: 'DE',
    name: 'Germany',
    enable: true,
    ipEnable: true,
    updated: undefined,
    created: undefined,
  }
  
  const updatePersonalData: KycUserDataDto = {
    accountType: AccountType.PERSONAL,
    firstname: 'Test',
    surname: 'TestFamily',
    street: 'A',
    houseNumber: '42',
    location: 'B',
    zip: '43210',
    country: testCountry,
    mail: 'test@update.com',
    phone: '+49 123456712',
    organizationName: undefined,
    organizationCountry: undefined,
    organizationHouseNumber: undefined,
    organizationLocation: undefined,
    organizationStreet: undefined,
    organizationZip: undefined,
  }

  function kycHashFor(mock: MockData): string {
    switch (mock) {
      case MockData.EMPTY: return 'F1D9C830-0D80-11ED-AA05-0800200C9A66'
      case MockData.COMPLETE, MockData.STARTED: return 'C12508A0-0D83-11ED-AA05-0800200C9A66'
    }
  }

  function userDataIdFor(mock: MockData): number {
    switch (mock) {
      case MockData.EMPTY: return 1
      case MockData.COMPLETE, MockData.STARTED: return 2
    }
  }

  function setup(mock: MockData) {
    let wantedUserData: UserData
    switch (mock) {
      case MockData.EMPTY:
        wantedUserData = {
          id: userDataIdFor(mock),
          kycHash: kycHashFor(mock),
          kycState: KycState.NA,
          kycStatus: KycStatus.NA,
          depositLimit: 90000,
        } as UserData
        break
      case MockData.COMPLETE:
      case MockData.STARTED:
        wantedUserData = {
          id: userDataIdFor(mock),
          kycHash: kycHashFor(mock),
          kycState: KycState.NA,
          kycStatus: mock === MockData.STARTED ? KycStatus.CHATBOT : KycStatus.NA,
          firstname: "FirstUserName",
          surname: "SurUsername",
          country: testCountry,
          accountType: AccountType.PERSONAL,
          mail: 'test@test.com',
          phone: '+49 123456789',
          depositLimit: 90000,
          street: 'Street',
          houseNumber: '42',
          location: 'Location',
          zip: '43210',
        } as UserData
        break
      default:
        break
    }

    jest.spyOn(userDataRepo, 'findOne').mockResolvedValue(wantedUserData)
    jest.spyOn(kycProcess, 'startKycProcess').mockImplementation((userData) => {
      if (userData.kycStatus === KycStatus.NA) {
        userData.kycStatus = KycStatus.CHATBOT
      }
      return Promise.resolve(userData)
    })
    jest.spyOn(userDataService, 'getUserDataByUser').mockImplementation(() => { return Promise.resolve(wantedUserData) })
    jest.spyOn(countryService, 'getCountry').mockImplementation(() => { return Promise.resolve(testCountry) })
    jest.spyOn(userDataService, 'updateSpiderIfNeeded').mockImplementation((userData, dto) => {
      if (userData.kycStatus !== KycStatus.NA && ((dto.phone && userData.phone !== dto.phone) || (dto.mail && userData.mail !== dto.mail))) {
        userData.kycState = KycState.FAILED
      }
      return Promise.resolve()
    })
    jest.spyOn(kycProcess, 'checkKycProcess').mockImplementation((userData) => { return Promise.resolve(userData) })
    jest.spyOn(userDataRepo, 'save').mockImplementation((entity) => { return Promise.resolve(entity as UserData) })
  }

  function createKycInfo(kycState: KycState, kycStatus: KycStatus, kycHash: string, kycDataComplete: boolean, depositLimit?: number, blankedMail?: string, blankedPhone?: string, sessionUrl?: string, setupUrl?: string): KycInfo {
    return { kycState, kycStatus, kycHash, kycDataComplete, blankedMail, blankedPhone, depositLimit, setupUrl, sessionUrl }
  }

  beforeEach(async () => {
    userDataService = createMock<UserDataService>()
    userDataRepo = createMock<UserDataRepository>()
    spiderService = createMock<SpiderService>()
    spiderSyncService = createMock<SpiderSyncService>()
    countryService = createMock<CountryService>()
    kycProcess = createMock<KycProcessService>()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: UserDataService, useValue: userDataService },
        { provide: UserDataRepository, useValue: userDataRepo },
        { provide: SpiderService, useValue: spiderService },
        { provide: SpiderSyncService, useValue: spiderSyncService },
        { provide: CountryService, useValue: countryService },
        { provide: KycProcessService, useValue: kycProcess },
        TestUtil.provideConfig(),
      ],
    }).compile()

    service = module.get<KycService>(KycService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('should return current kyc progress for incomplete user', async () => {
    setup(MockData.EMPTY)
    
    const kycHash = kycHashFor(MockData.EMPTY)
    await expect(service.getKycStatus(kycHash)).resolves.toStrictEqual(createKycInfo(KycState.NA, KycStatus.NA, kycHash, false, 90000))
  })

  it('should return current kyc progress for complete user', async () => {
    setup(MockData.COMPLETE)
    
    const kycHash = kycHashFor(MockData.COMPLETE)
    await expect(service.getKycStatus(kycHash)).resolves.toStrictEqual(createKycInfo(KycState.NA, KycStatus.NA, kycHash, true, 90000, 't***@test.com', '***********89'))
  })

  it('should return current kyc progress for started user', async () => {
    setup(MockData.STARTED)
    
    const kycHash = kycHashFor(MockData.STARTED)
    await expect(service.getKycStatus(kycHash)).resolves.toStrictEqual(createKycInfo(KycState.NA, KycStatus.CHATBOT, kycHash, true, 90000, 't***@test.com', '***********89'))
  })

  it('should throw error on getting kyc progress if user is not found with code', async () => {
    setup(MockData.CLEAN_DB)

    const kycHash = kycHashFor(MockData.EMPTY)

    const testCall = async () => await service.getKycStatus(kycHash)

    await expect(testCall).rejects.toThrow(NotFoundException)
    await expect(testCall).rejects.toThrowError('User not found')
  })

  it('should start kyc progress with code', async () => {
    setup(MockData.COMPLETE)

    const kycHash = kycHashFor(MockData.COMPLETE)
    await expect(service.requestKyc(kycHash)).resolves.toStrictEqual(createKycInfo(KycState.NA, KycStatus.CHATBOT, kycHash, true, 90000, 't***@test.com', '***********89'))
  })

  it('should start kyc progress with empty code and user id', async () => {
    setup(MockData.COMPLETE)

    const kycHash = kycHashFor(MockData.COMPLETE)
    // in our test setup: user id and user data id are equal
    const userDataId = userDataIdFor(MockData.COMPLETE)
    await expect(service.requestKyc("", userDataId)).resolves.toStrictEqual(createKycInfo(KycState.NA, KycStatus.CHATBOT, kycHash, true, 90000, 't***@test.com', '***********89'))
  })

  it('should throw error on start kyc progress if user is not found with code', async () => {
    setup(MockData.CLEAN_DB)

    const kycHash = kycHashFor(MockData.EMPTY)

    const testCall = async () => await service.requestKyc(kycHash)

    await expect(testCall).rejects.toThrow(NotFoundException)
    await expect(testCall).rejects.toThrowError('User not found')
  })

  it('should throw error on start kyc progress if user is not found with user id', async () => {
    setup(MockData.CLEAN_DB)

    const userDataId = userDataIdFor(MockData.EMPTY)

    const testCall = async () => await service.requestKyc("", userDataId)

    await expect(testCall).rejects.toThrow(NotFoundException)
    await expect(testCall).rejects.toThrowError('User not found')
  })

  it('should update kyc data with code', async () => {
    setup(MockData.EMPTY)

    const kycHash = kycHashFor(MockData.EMPTY)
    await expect(service.updateKycData(kycHash, updatePersonalData)).resolves.toStrictEqual(createKycInfo(KycState.NA, KycStatus.NA, kycHash, true, 90000, 't***@update.com', '***********12'))
  })

  it('should update kyc data with empty code and user id', async () => {
    setup(MockData.EMPTY)

    const kycHash = kycHashFor(MockData.EMPTY)
    const userDataId = userDataIdFor(MockData.EMPTY)
    await expect(service.updateKycData("", updatePersonalData, userDataId)).resolves.toStrictEqual(createKycInfo(KycState.NA, KycStatus.NA, kycHash, true, 90000, 't***@update.com', '***********12'))
  })

  it('should throw error on update kyc data if user is not found with code', async () => {
    setup(MockData.CLEAN_DB)

    const kycHash = kycHashFor(MockData.EMPTY)

    const testCall = async () => await service.updateKycData(kycHash, updatePersonalData)

    await expect(testCall).rejects.toThrow(NotFoundException)
    await expect(testCall).rejects.toThrowError('User not found')
  })

  it('should throw error on update kyc data if user is not found with user id', async () => {
    setup(MockData.CLEAN_DB)

    const userDataId = userDataIdFor(MockData.EMPTY)

    const testCall = async () => await service.updateKycData("", updatePersonalData, userDataId)

    await expect(testCall).rejects.toThrow(NotFoundException)
    await expect(testCall).rejects.toThrowError('User not found')
  })
})