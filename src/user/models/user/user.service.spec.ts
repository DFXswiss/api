import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { BuyService } from '../buy/buy.service';
import { LogService } from '../log/log.service';
import { UserDataService } from '../userData/userData.service';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';
import { User } from './user.entity';
import { StakingService } from '../staking/staking.service';

describe('UserService', () => {
  let service: UserService;

  let userRepo: UserRepository;
  let userDataService: UserDataService;
  let logService: LogService;
  let countryService: CountryService;
  let languageService: LanguageService;
  let fiatService: FiatService;
  let buyService: BuyService;
  let stakingService: StakingService;

  function setup(volume: number, refUser?: Partial<User>) {
    jest.spyOn(buyService, 'getUserVolume').mockResolvedValueOnce({ volume: 0, annualVolume: volume });
    jest.spyOn(userRepo, 'findOne').mockResolvedValueOnce(refUser as User);
  }

  beforeEach(async () => {
    userRepo = createMock<UserRepository>();
    userDataService = createMock<UserDataService>();
    logService = createMock<LogService>();
    countryService = createMock<CountryService>();
    languageService = createMock<LanguageService>();
    fiatService = createMock<FiatService>();
    buyService = createMock<BuyService>();
    stakingService = createMock<StakingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: userRepo },
        { provide: UserDataService, useValue: userDataService },
        { provide: LogService, useValue: logService },
        { provide: CountryService, useValue: countryService },
        { provide: LanguageService, useValue: languageService },
        { provide: FiatService, useValue: fiatService },
        { provide: BuyService, useValue: buyService },
        { provide: StakingService, useValue: stakingService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ref bonus
  it('should return base fee when no ref user', async () => {
    setup(0);

    const user = { id: 1, usedRef: '000-000' } as User;
    await expect(service.getFees(user)).resolves.toStrictEqual({ buy: 2.9, refBonus: 0, sell: 2.9 });
  });

  it('should return 0.5% bonus from ref user', async () => {
    setup(0, { refFeePercent: 0.5 });

    const user = { id: 1, usedRef: '000-000' } as User;
    await expect(service.getFees(user)).resolves.toStrictEqual({ buy: 2.4, refBonus: 0.5, sell: 2.9 });
  });

  it('should return 0.9% bonus from ref user', async () => {
    setup(0, { refFeePercent: 0.1 });

    const user = { id: 1, usedRef: '000-000' } as User;
    await expect(service.getFees(user)).resolves.toStrictEqual({ buy: 2.0, refBonus: 0.9, sell: 2.9 });
  });

  // volume
  it('should return base fee when volume < 5000', async () => {
    setup(4999.99);

    const user = { id: 1, usedRef: '000-000' } as User;
    await expect(service.getFees(user)).resolves.toStrictEqual({ buy: 2.9, refBonus: 0, sell: 2.9 });
  });

  it('should return 1.75 when volume = 5000 and ref user', async () => {
    setup(5000, { refFeePercent: 0.1 });

    const user = { id: 1, usedRef: '000-000' } as User;
    await expect(service.getFees(user)).resolves.toStrictEqual({ buy: 1.75, refBonus: 0.9, sell: 2.9 });
  });

  it('should return 2.4 when volume > 50000', async () => {
    setup(64358);

    const user = { id: 1, usedRef: '000-000' } as User;
    await expect(service.getFees(user)).resolves.toStrictEqual({ buy: 2.4, refBonus: 0, sell: 2.9 });
  });

  // > 100'000
  it('should return 1.4 and no bonus when volume > 100000 and no ref user', async () => {
    setup(100000);

    const user = { id: 1, usedRef: '000-000' } as User;
    await expect(service.getFees(user)).resolves.toStrictEqual({ buy: 1.4, refBonus: 0, sell: 2.9 });
  });

  it('should return 1.4 and no bonus when volume > 100000 and ref user', async () => {
    setup(100000, { refFeePercent: 0.5 });

    const user = { id: 1, usedRef: '000-000' } as User;
    await expect(service.getFees(user)).resolves.toStrictEqual({ buy: 1.4, refBonus: 0, sell: 2.9 });
  });
});
