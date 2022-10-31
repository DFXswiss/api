import { Test, TestingModule } from '@nestjs/testing';
import { DeFiClient } from 'src/blockchain/ain/node/defi-client';
import { NodeService } from 'src/blockchain/ain/node/node.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SellService } from 'src/payment/models/sell/sell.service';
import { CryptoInputRepository } from './crypto-input.repository';
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
import { BehaviorSubject } from 'rxjs';
import { DeFiInputService } from './defi-input.service';
import { HttpService } from '@nestjs/axios';
import { BuyFiatService } from '../buy-fiat/buy-fiat.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';

describe('DeFiInputService', () => {
  let service: DeFiInputService;

  let nodeClient: DeFiClient;
  let nodeService: NodeService;
  let cryptoInputRepo: CryptoInputRepository;
  let cryptoStakingService: CryptoStakingService;
  let assetService: AssetService;
  let sellService: SellService;
  let stakingService: StakingService;
  let http: HttpService;
  let buyFiatService: BuyFiatService;

  function setup(headers: number, blocks: number, lastBlocks: number, addresses: string[]) {
    const utxo = addresses.map((a) => ({ amount: new BigNumber(1), address: a } as unknown as UTXO));

    jest.spyOn(nodeClient, 'getInfo').mockResolvedValueOnce({ headers, blocks } as BlockchainInfo);
    jest.spyOn(cryptoInputRepo, 'findOne').mockResolvedValueOnce({ blockHeight: lastBlocks } as CryptoInput);
    jest.spyOn(nodeClient, 'getUtxo').mockResolvedValueOnce(utxo);
    jest.spyOn(nodeClient, 'getToken').mockResolvedValueOnce([]);
    jest.spyOn(nodeClient, 'getHistories').mockResolvedValueOnce([]);
  }

  beforeEach(async () => {
    nodeClient = createMock<DeFiClient>();
    nodeService = createMock<NodeService>();
    cryptoInputRepo = createMock<CryptoInputRepository>();
    assetService = createMock<AssetService>();
    sellService = createMock<SellService>();
    stakingService = createMock<StakingService>();
    cryptoStakingService = createMock<CryptoStakingService>();
    http = createMock<HttpService>();
    buyFiatService = createMock<BuyFiatService>();

    jest
      .spyOn(nodeService, 'getConnectedNode')
      .mockImplementation(() => new BehaviorSubject(nodeClient).asObservable());
    jest.spyOn(nodeClient, 'parseAmount').mockImplementation((a) => ({
      amount: +a.split('@')[0],
      asset: a.split('@')[1],
    }));

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        DeFiInputService,
        { provide: NodeService, useValue: nodeService },
        { provide: CryptoInputRepository, useValue: cryptoInputRepo },
        { provide: AssetService, useValue: assetService },
        { provide: SellService, useValue: sellService },
        { provide: StakingService, useValue: stakingService },
        { provide: CryptoStakingService, useValue: cryptoStakingService },
        { provide: HttpService, useValue: http },
        { provide: BuyFiatService, useValue: buyFiatService },
        TestUtil.provideConfig({
          blockchain: { default: { utxoSpenderAddress: 'addr2', minDeposit: { DeFiChain: { DFI: 0.01 } } } },
        }),
      ],
    }).compile();

    service = module.get<DeFiInputService>(DeFiInputService);
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
  it('should return coin on receive', () => {
    expect(service.getAmounts({ type: 'receive', amounts: ['3@DFI'] } as AccountHistory)).toStrictEqual([
      {
        amount: 3,
        asset: 'DFI',
        type: AssetType.COIN,
      },
    ]);
  });

  it('should return positive amount and coin on AccountToUtxos', () => {
    expect(service.getAmounts({ type: 'AccountToUtxos', amounts: ['-2.456@DFI'] } as AccountHistory)).toStrictEqual([
      {
        amount: 2.456,
        asset: 'DFI',
        type: AssetType.COIN,
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
        type: AssetType.TOKEN,
      },
      {
        amount: 3,
        asset: 'USDT',
        type: AssetType.TOKEN,
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
        type: AssetType.TOKEN,
      },
    ]);
  });

  it('should return only positive amounts and token on PoolSwap', () => {
    expect(service.getAmounts({ type: 'PoolSwap', amounts: ['-2@BTC', '3@USDT'] } as AccountHistory)).toStrictEqual([
      {
        amount: 3,
        asset: 'USDT',
        type: AssetType.TOKEN,
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
        type: AssetType.TOKEN,
      },
      {
        amount: 1,
        asset: 'DFI',
        type: AssetType.TOKEN,
      },
    ]);
  });
});
