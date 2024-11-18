import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { BuyRepository } from '../buy.repository';
import { BuyService } from '../buy.service';

describe('BuyService', () => {
  let service: BuyService;

  let buyRepo: BuyRepository;
  let assetService: AssetService;
  let userService: UserService;
  let bankAccountService: BankAccountService;
  let routeService: RouteService;
  let bankDataService: BankDataService;

  beforeEach(async () => {
    buyRepo = createMock<BuyRepository>();
    assetService = createMock<AssetService>();
    userService = createMock<UserService>();
    bankAccountService = createMock<BankAccountService>();
    routeService = createMock<RouteService>();
    bankDataService = createMock<BankDataService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyService,
        { provide: BuyRepository, useValue: buyRepo },
        { provide: AssetService, useValue: assetService },
        { provide: UserService, useValue: userService },
        { provide: BankAccountService, useValue: bankAccountService },
        { provide: RouteService, useValue: routeService },
        { provide: BankDataService, useValue: bankDataService },
      ],
    }).compile();

    service = module.get<BuyService>(BuyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
