import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { UserDataService } from '../user-data/user-data.service';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';
import { IdentService } from '../ident/ident.service';
import { WalletService } from '../wallet/wallet.service';
import { SettingService } from 'src/shared/models/setting/setting.service';

describe('UserService', () => {
  let service: UserService;

  let userRepo: UserRepository;
  let userDataService: UserDataService;
  let fiatService: FiatService;
  let identService: IdentService;
  let walletService: WalletService;
  let settingService: SettingService;

  beforeEach(async () => {
    userRepo = createMock<UserRepository>();
    userDataService = createMock<UserDataService>();
    fiatService = createMock<FiatService>();
    identService = createMock<IdentService>();
    walletService = createMock<WalletService>();
    settingService = createMock<SettingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: userRepo },
        { provide: UserDataService, useValue: userDataService },
        { provide: FiatService, useValue: fiatService },
        { provide: IdentService, useValue: identService },
        { provide: WalletService, useValue: walletService },
        { provide: SettingService, useValue: settingService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
