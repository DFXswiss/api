import { Test, TestingModule } from '@nestjs/testing';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService } from 'src/ain/node/node.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellService } from 'src/payment/models/sell/sell.service';
import { CryptoInputRepository } from './crypto-input.repository';
import { CryptoInputService } from './crypto-input.service';
import { createMock } from '@golevelup/ts-jest';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { CryptoInput } from './crypto-input.entity';
import { StakingService } from 'src/payment/models/staking/staking.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { TestUtil } from 'src/shared/test.util';

describe('CryptoInputService', () => {
  let service: CryptoInputService;

  let nodeClient: NodeClient;
  let nodeService: NodeService;
  let cryptoInputRepo: CryptoInputRepository;
  let assetService: AssetService;
  let sellService: SellService;
  let stakingService: StakingService;

  function setup(headers: number, blocks: number, lastBlocks: number, addresses: string[]) {
    jest.spyOn(nodeClient, 'getInfo').mockResolvedValueOnce({ headers, blocks } as BlockchainInfo);
    jest.spyOn(cryptoInputRepo, 'findOne').mockResolvedValueOnce({ blockHeight: lastBlocks } as CryptoInput);
    jest.spyOn(nodeClient, 'getAddressesWithFunds').mockResolvedValueOnce(addresses);
    jest.spyOn(nodeClient, 'getHistories').mockResolvedValueOnce([]);
  }

  beforeEach(async () => {
    nodeClient = createMock<NodeClient>();
    nodeService = createMock<NodeService>();
    cryptoInputRepo = createMock<CryptoInputRepository>();
    assetService = createMock<AssetService>();
    sellService = createMock<SellService>();
    stakingService = createMock<StakingService>();

    jest.spyOn(nodeService, 'getClient').mockImplementation(() => nodeClient);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        CryptoInputService,
        { provide: NodeService, useValue: nodeService },
        { provide: CryptoInputRepository, useValue: cryptoInputRepo },
        { provide: AssetService, useValue: assetService },
        { provide: SellService, useValue: sellService },
        { provide: StakingService, useValue: stakingService },
        TestUtil.provideConfig({ node: { utxoSpenderAddress: 'addr2' } }),
      ],
    }).compile();

    service = module.get<CryptoInputService>(CryptoInputService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should stop on desynchronized chain', async () => {
    const headers = 340;
    const blocks = 339;
    const lastBlocks = 0;

    setup(headers, blocks, lastBlocks, ['addr']);

    await service.checkInputs();

    expect(cryptoInputRepo.findOne).toHaveBeenCalledTimes(0);
  });

  it('should get history with correct addresses and block height', async () => {
    const headers = 51;
    const blocks = 51;
    const lastBlocks = 34;

    setup(headers, blocks, lastBlocks, ['addr1', 'addr2', 'addr3']);

    await service.checkInputs();

    expect(nodeClient.getHistories).toHaveBeenCalledTimes(1);
    expect(nodeClient.getHistories).toHaveBeenCalledWith(['addr1', 'addr3'], lastBlocks + 1, blocks);
  });

  // TODO: do more tests
});
