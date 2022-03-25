import { Test, TestingModule } from '@nestjs/testing';
import { CryptoStakingRepository } from './crypto-staking.repository';
import { CryptoStakingService } from './crypto-staking.service';
import { createMock } from '@golevelup/ts-jest';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { TestUtil } from 'src/shared/test.util';
import { CryptoInputService } from '../crypto-input/crypto-input.service';
import { ConversionService } from 'src/shared/services/conversion.service';
import { NodeService } from 'src/ain/node/node.service';
import { StakingService } from '../staking/staking.service';
import { StakingRewardRepository } from '../staking-reward/staking-reward.respository';
import { CryptoInputRepository } from '../crypto-input/crypto-input.repository';

describe('CryptoStakingService', () => {
  let cryptoInputService: CryptoInputService;
  let cryptoStakingService: CryptoStakingService;
  let cryptoStakingRepo: CryptoStakingRepository;
  let stakingRewardRepo: StakingRewardRepository;
  let conversionService: ConversionService;
  let stakingService: StakingService;
  let nodeService: NodeService;

  beforeEach(async () => {
    cryptoStakingRepo = createMock<CryptoStakingRepository>();
    stakingRewardRepo = createMock<StakingRewardRepository>();
    conversionService = createMock<ConversionService>();
    cryptoInputService = createMock<CryptoInputService>();
    stakingService = createMock<StakingService>();
    nodeService = createMock<NodeService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        CryptoStakingService,
        { provide: CryptoStakingRepository, useValue: cryptoStakingRepo },
        { provide: StakingRewardRepository, useValue: stakingRewardRepo },
        { provide: ConversionService, useValue: conversionService },
        { provide: CryptoInputService, useValue: cryptoInputService },
        { provide: StakingService, useValue: stakingService },
        { provide: NodeService, useValue: nodeService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    cryptoStakingService = module.get<CryptoStakingService>(CryptoStakingService);
  });

  it('should be defined', () => {
    expect(cryptoStakingService).toBeDefined();
  });

  // TODO: do more tests
});
