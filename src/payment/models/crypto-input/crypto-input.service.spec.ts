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
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { BigNumber } from '@defichain/jellyfish-json';
import { StakingService } from 'src/payment/models/staking/staking.service';

describe('CryptoInputService', () => {
  let service: CryptoInputService;

  let nodeClient: NodeClient;
  let nodeService: NodeService;
  let cryptoInputRepo: CryptoInputRepository;
  let assetService: AssetService;
  let sellService: SellService;
  let stakingService: StakingService;

  function setup(blocks: number, lastBlocks: number, utxo: UTXO[]) {
    jest.spyOn(nodeClient, 'getInfo').mockResolvedValueOnce({ blocks: blocks } as BlockchainInfo);
    jest.spyOn(cryptoInputRepo, 'findOne').mockResolvedValueOnce({ blockHeight: lastBlocks } as CryptoInput);
    jest.spyOn(nodeClient, 'getUtxo').mockResolvedValueOnce(utxo);
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
      providers: [
        CryptoInputService,
        { provide: NodeService, useValue: nodeService },
        { provide: CryptoInputRepository, useValue: cryptoInputRepo },
        { provide: AssetService, useValue: assetService },
        { provide: SellService, useValue: sellService },
        { provide: StakingService, useValue: stakingService },
      ],
    }).compile();

    service = module.get<CryptoInputService>(CryptoInputService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should ignore small UTXO amounts', async () => {
    setup(0, 0, [{ address: 'addr', amount: new BigNumber(0.005) }] as UTXO[]);

    await service.checkInputs();

    expect(nodeClient.getHistory).toHaveBeenCalledTimes(0);
  });

  it('should remove address duplicates', async () => {
    setup(0, 0, [
      { address: 'addr', amount: new BigNumber(4) },
      { address: 'addr', amount: new BigNumber(3) },
    ] as UTXO[]);

    await service.checkInputs();

    expect(nodeClient.getHistory).toHaveBeenCalledTimes(1);
  });

  it('should get history with correct address and block height', async () => {
    const blocks = 46;
    const lastBlocks = 34;

    setup(blocks, lastBlocks, [
      { address: 'addr1', amount: new BigNumber(4) },
      { address: 'addr1', amount: new BigNumber(3) },
      { address: 'addr2', amount: new BigNumber(2) },
    ] as UTXO[]);

    await service.checkInputs();

    expect(nodeClient.getHistory).toHaveBeenCalledTimes(2);
    expect(nodeClient.getHistory).toHaveBeenCalledWith('addr1', lastBlocks + 1, blocks);
    expect(nodeClient.getHistory).toHaveBeenCalledWith('addr2', lastBlocks + 1, blocks);
  });

  // TODO: do more tests
});
