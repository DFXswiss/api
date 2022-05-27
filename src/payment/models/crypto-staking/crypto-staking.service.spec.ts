import { Test, TestingModule } from '@nestjs/testing';
import { CryptoStakingRepository } from './crypto-staking.repository';
import { CryptoStakingService } from './crypto-staking.service';
import { createMock } from '@golevelup/ts-jest';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { TestUtil } from 'src/shared/test.util';
import { ConversionService } from 'src/shared/services/conversion.service';
import { NodeService } from 'src/ain/node/node.service';
import { StakingService } from '../staking/staking.service';
import { StakingRewardRepository } from '../staking-reward/staking-reward.respository';
import { StakingRefRewardRepository } from '../staking-ref-reward/staking-ref-reward.repository';
import { StakingRepository } from '../staking/staking.repository';

describe('CryptoStakingService', () => {
  let service: CryptoStakingService;

  let cryptoStakingRepo: CryptoStakingRepository;
  let stakingRewardRepo: StakingRewardRepository;
  let stakingRefRewardRepo: StakingRefRewardRepository;
  let stakingRepo: StakingRepository;
  let conversionService: ConversionService;
  let stakingService: StakingService;
  let nodeService: NodeService;

  beforeEach(async () => {
    cryptoStakingRepo = createMock<CryptoStakingRepository>();
    stakingRewardRepo = createMock<StakingRewardRepository>();
    stakingRefRewardRepo = createMock<StakingRefRewardRepository>();
    stakingRepo = createMock<StakingRepository>();
    conversionService = createMock<ConversionService>();
    stakingService = createMock<StakingService>();
    nodeService = createMock<NodeService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        CryptoStakingService,
        { provide: CryptoStakingRepository, useValue: cryptoStakingRepo },
        { provide: StakingRewardRepository, useValue: stakingRewardRepo },
        { provide: StakingRefRewardRepository, useValue: stakingRefRewardRepo },
        { provide: StakingRepository, useValue: stakingRepo },
        { provide: ConversionService, useValue: conversionService },
        { provide: StakingService, useValue: stakingService },
        { provide: NodeService, useValue: nodeService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<CryptoStakingService>(CryptoStakingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // TODO: do more tests
});
