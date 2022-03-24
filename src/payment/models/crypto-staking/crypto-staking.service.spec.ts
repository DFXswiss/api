import { Test, TestingModule } from '@nestjs/testing';
import { CryptoStakingRepository } from './crypto-staking.repository';
import { CryptoStakingService } from './crypto-staking.service';
import { createMock } from '@golevelup/ts-jest';
import { CryptoStaking } from './crypto-staking.entity';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { TestUtil } from 'src/shared/test.util';

describe('CryptoInputService', () => {
  let service: CryptoStakingService;

  let cryptoStakingRepo: CryptoStakingRepository;

  function setup() {
    jest.spyOn(cryptoStakingRepo, 'findOne').mockResolvedValueOnce({} as CryptoStaking);
  }

  beforeEach(async () => {
    cryptoStakingRepo = createMock<CryptoStakingRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        CryptoStakingService,
        { provide: CryptoStakingRepository, useValue: cryptoStakingRepo },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<CryptoStakingService>(CryptoStakingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should', async () => {
    setup();
    expect(cryptoStakingRepo.findOne).toHaveBeenCalledTimes(0);
  });

  // TODO: do more tests
});
