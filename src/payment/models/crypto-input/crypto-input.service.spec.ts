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
import { AccountHistory } from '@defichain/jellyfish-api-core/dist/category/account';
import { UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import BigNumber from 'bignumber.js';
import { CryptoStakingService } from '../crypto-staking/crypto-staking.service';

describe('CryptoInputService', () => {
  let service: CryptoInputService;

  let nodeClient: NodeClient;
  let nodeService: NodeService;
  let cryptoInputRepo: CryptoInputRepository;
  let cryptoStakingService: CryptoStakingService;
  let assetService: AssetService;
  let sellService: SellService;
  let stakingService: StakingService;

  function setup(headers: number, blocks: number, lastBlocks: number, addresses: string[]) {
    const utxo = addresses.map((a) => ({ amount: new BigNumber(1), address: a } as unknown as UTXO));

    jest.spyOn(nodeClient, 'getInfo').mockResolvedValueOnce({ headers, blocks } as BlockchainInfo);
    jest.spyOn(cryptoInputRepo, 'findOne').mockResolvedValueOnce({ blockHeight: lastBlocks } as CryptoInput);
    jest.spyOn(nodeClient, 'getUtxo').mockResolvedValueOnce(utxo);
    jest.spyOn(nodeClient, 'getToken').mockResolvedValueOnce([]);
    jest.spyOn(nodeClient, 'getHistories').mockResolvedValueOnce([]);
  }

  beforeEach(async () => {
    nodeClient = createMock<NodeClient>();
    nodeService = createMock<NodeService>();
    cryptoInputRepo = createMock<CryptoInputRepository>();
    assetService = createMock<AssetService>();
    sellService = createMock<SellService>();
    stakingService = createMock<StakingService>();
    cryptoStakingService = createMock<CryptoStakingService>();

    jest.spyOn(nodeService, 'getClient').mockImplementation(() => nodeClient);
    jest.spyOn(nodeClient, 'parseAmount').mockImplementation((a) => ({
      amount: +a.split('@')[0],
      asset: a.split('@')[1],
    }));

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        CryptoInputService,
        { provide: NodeService, useValue: nodeService },
        { provide: CryptoInputRepository, useValue: cryptoInputRepo },
        { provide: AssetService, useValue: assetService },
        { provide: SellService, useValue: sellService },
        { provide: StakingService, useValue: stakingService },
        { provide: CryptoStakingService, useValue: cryptoStakingService },
        TestUtil.provideConfig({ node: { minDfiDeposit: 0.01, utxoSpenderAddress: 'addr2' } }),
      ],
    }).compile();

    service = module.get<CryptoInputService>(CryptoInputService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should stop on desynchronized chain', async () => {
    const headers = 340;
    const blocks = 338;
    const lastBlocks = 0;

    setup(headers, blocks, lastBlocks, ['addr']);

    await service.checkInputs();

    expect(cryptoInputRepo.findOne).toHaveBeenCalledTimes(0);
  });

  it('should get history with correct addresses and block height', async () => {
    const headers = 51;
    const blocks = 50;
    const lastBlocks = 34;

    setup(headers, blocks, lastBlocks, ['addr1', 'addr2', 'addr3']);

    await service.checkInputs();

    expect(nodeClient.getHistories).toHaveBeenCalledTimes(1);
    expect(nodeClient.getHistories).toHaveBeenCalledWith(['addr1', 'addr3'], lastBlocks + 1, blocks);
  });

  // --- AMOUNTS --- //
  it('should return UTXO on receive', () => {
    expect(service.getAmounts({ type: 'receive', amounts: ['3@DFI'] } as AccountHistory)).toStrictEqual([
      {
        amount: 3,
        asset: 'DFI',
        isToken: false,
      },
    ]);
  });

  it('should return positive amount and UTXO on AccountToUtxos', () => {
    expect(service.getAmounts({ type: 'AccountToUtxos', amounts: ['-2.456@DFI'] } as AccountHistory)).toStrictEqual([
      {
        amount: 2.456,
        asset: 'DFI',
        isToken: false,
      },
    ]);
  });

  it('should return multiple amounts and token on AccountToAccount', () => {
    expect(
      service.getAmounts({ type: 'AccountToAccount', amounts: ['2@BTC', '3@USDT'] } as AccountHistory),
    ).toStrictEqual([
      {
        amount: 2,
        asset: 'BTC',
        isToken: true,
      },
      {
        amount: 3,
        asset: 'USDT',
        isToken: true,
      },
    ]);
  });

  it('should return no amounts on AccountToAccount, if amount is negative', () => {
    expect(service.getAmounts({ type: 'AccountToAccount', amounts: ['-2@BTC'] } as AccountHistory)).toStrictEqual([]);
  });

  it('should return token on WithdrawFromVault', () => {
    expect(service.getAmounts({ type: 'WithdrawFromVault', amounts: ['1@DFI'] } as AccountHistory)).toStrictEqual([
      {
        amount: 1,
        asset: 'DFI',
        isToken: true,
      },
    ]);
  });

  it('should return only positive amounts and token on PoolSwap', () => {
    expect(service.getAmounts({ type: 'PoolSwap', amounts: ['-2@BTC', '3@USDT'] } as AccountHistory)).toStrictEqual([
      {
        amount: 3,
        asset: 'USDT',
        isToken: true,
      },
    ]);
  });

  it('should return only positive amounts and token on RemovePoolLiquidity', () => {
    expect(
      service.getAmounts({ type: 'RemovePoolLiquidity', amounts: ['-2@BTC-DFI', '3@BTC', '1@DFI'] } as AccountHistory),
    ).toStrictEqual([
      {
        amount: 3,
        asset: 'BTC',
        isToken: true,
      },
      {
        amount: 1,
        asset: 'DFI',
        isToken: true,
      },
    ]);
  });

  // TODO: do more tests
});
