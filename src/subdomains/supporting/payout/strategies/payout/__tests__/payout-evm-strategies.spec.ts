import { mock } from 'jest-mock-extended';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { toBaseUnits } from 'src/shared/models/base-units.transformer';
import { createCustomPayoutOrder } from '../../../entities/__mocks__/payout-order.entity.mock';
import { PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { ArbitrumCoinStrategy } from '../impl/arbitrum-coin.strategy';
import { ArbitrumTokenStrategy } from '../impl/arbitrum-token.strategy';
import { EvmStrategy } from '../impl/base/evm.strategy';
import { BaseCoinStrategy } from '../impl/base-coin.strategy';
import { BaseTokenStrategy } from '../impl/base-token.strategy';
import { BscCoinStrategy } from '../impl/bsc-coin.strategy';
import { BscTokenStrategy } from '../impl/bsc-token.strategy';
import { CitreaCoinStrategy } from '../impl/citrea-coin.strategy';
import { CitreaTokenStrategy } from '../impl/citrea-token.strategy';
import { EthereumCoinStrategy } from '../impl/ethereum-coin.strategy';
import { EthereumTokenStrategy } from '../impl/ethereum-token.strategy';
import { GnosisCoinStrategy } from '../impl/gnosis-coin.strategy';
import { GnosisTokenStrategy } from '../impl/gnosis-token.strategy';
import { OptimismCoinStrategy } from '../impl/optimism-coin.strategy';
import { OptimismTokenStrategy } from '../impl/optimism-token.strategy';
import { PolygonCoinStrategy } from '../impl/polygon-coin.strategy';
import { PolygonTokenStrategy } from '../impl/polygon-token.strategy';
import { SepoliaCoinStrategy } from '../impl/sepolia-coin.strategy';
import { SepoliaTokenStrategy } from '../impl/sepolia-token.strategy';

// The EVM payout services (PayoutArbitrumService, PayoutBscService, ...) differ by static type but
// expose the same broadcast/gas surface used by the strategies; a single generic jest mock covers
// all of them (cast to `any` at the constructor since the concrete type varies per strategy).
interface EvmServiceMock {
  sendNativeCoin: jest.Mock;
  sendToken: jest.Mock;
  getCurrentGasForCoinTransaction: jest.Mock;
  getCurrentGasForTokenTransaction: jest.Mock;
}

function createEvmServiceMock(): EvmServiceMock {
  return {
    sendNativeCoin: jest.fn(),
    sendToken: jest.fn(),
    getCurrentGasForCoinTransaction: jest.fn(),
    getCurrentGasForTokenTransaction: jest.fn(),
  };
}

type EvmStrategyCtor = new (
  service: any,
  assetService: AssetService,
  payoutOrderRepo: PayoutOrderRepository,
) => EvmStrategy;

// Getters that resolve the fee asset on AssetService (assetService.getXCoin()).
type FeeAssetGetter =
  | 'getArbitrumCoin'
  | 'getBaseCoin'
  | 'getBnbCoin'
  | 'getCitreaCoin'
  | 'getEthCoin'
  | 'getGnosisCoin'
  | 'getOptimismCoin'
  | 'getPolygonCoin'
  | 'getSepoliaCoin';

interface EvmStrategyCase {
  name: string;
  Strategy: EvmStrategyCtor;
  blockchain: Blockchain;
  assetType: AssetType;
  isToken: boolean;
  feeAssetGetter: FeeAssetGetter;
}

const cases: EvmStrategyCase[] = [
  {
    name: 'ArbitrumCoinStrategy',
    Strategy: ArbitrumCoinStrategy,
    blockchain: Blockchain.ARBITRUM,
    assetType: AssetType.COIN,
    isToken: false,
    feeAssetGetter: 'getArbitrumCoin',
  },
  {
    name: 'ArbitrumTokenStrategy',
    Strategy: ArbitrumTokenStrategy,
    blockchain: Blockchain.ARBITRUM,
    assetType: AssetType.TOKEN,
    isToken: true,
    feeAssetGetter: 'getArbitrumCoin',
  },
  {
    name: 'BaseCoinStrategy',
    Strategy: BaseCoinStrategy,
    blockchain: Blockchain.BASE,
    assetType: AssetType.COIN,
    isToken: false,
    feeAssetGetter: 'getBaseCoin',
  },
  {
    name: 'BaseTokenStrategy',
    Strategy: BaseTokenStrategy,
    blockchain: Blockchain.BASE,
    assetType: AssetType.TOKEN,
    isToken: true,
    feeAssetGetter: 'getBaseCoin',
  },
  {
    name: 'BscCoinStrategy',
    Strategy: BscCoinStrategy,
    blockchain: Blockchain.BINANCE_SMART_CHAIN,
    assetType: AssetType.COIN,
    isToken: false,
    feeAssetGetter: 'getBnbCoin',
  },
  {
    name: 'BscTokenStrategy',
    Strategy: BscTokenStrategy,
    blockchain: Blockchain.BINANCE_SMART_CHAIN,
    assetType: AssetType.TOKEN,
    isToken: true,
    feeAssetGetter: 'getBnbCoin',
  },
  {
    name: 'CitreaCoinStrategy',
    Strategy: CitreaCoinStrategy,
    blockchain: Blockchain.CITREA,
    assetType: AssetType.COIN,
    isToken: false,
    feeAssetGetter: 'getCitreaCoin',
  },
  {
    name: 'CitreaTokenStrategy',
    Strategy: CitreaTokenStrategy,
    blockchain: Blockchain.CITREA,
    assetType: AssetType.TOKEN,
    isToken: true,
    feeAssetGetter: 'getCitreaCoin',
  },
  {
    name: 'EthereumCoinStrategy',
    Strategy: EthereumCoinStrategy,
    blockchain: Blockchain.ETHEREUM,
    assetType: AssetType.COIN,
    isToken: false,
    feeAssetGetter: 'getEthCoin',
  },
  {
    name: 'EthereumTokenStrategy',
    Strategy: EthereumTokenStrategy,
    blockchain: Blockchain.ETHEREUM,
    assetType: AssetType.TOKEN,
    isToken: true,
    feeAssetGetter: 'getEthCoin',
  },
  {
    name: 'GnosisCoinStrategy',
    Strategy: GnosisCoinStrategy,
    blockchain: Blockchain.GNOSIS,
    assetType: AssetType.COIN,
    isToken: false,
    feeAssetGetter: 'getGnosisCoin',
  },
  {
    name: 'GnosisTokenStrategy',
    Strategy: GnosisTokenStrategy,
    blockchain: Blockchain.GNOSIS,
    assetType: AssetType.TOKEN,
    isToken: true,
    feeAssetGetter: 'getGnosisCoin',
  },
  {
    name: 'OptimismCoinStrategy',
    Strategy: OptimismCoinStrategy,
    blockchain: Blockchain.OPTIMISM,
    assetType: AssetType.COIN,
    isToken: false,
    feeAssetGetter: 'getOptimismCoin',
  },
  {
    name: 'OptimismTokenStrategy',
    Strategy: OptimismTokenStrategy,
    blockchain: Blockchain.OPTIMISM,
    assetType: AssetType.TOKEN,
    isToken: true,
    feeAssetGetter: 'getOptimismCoin',
  },
  {
    name: 'PolygonCoinStrategy',
    Strategy: PolygonCoinStrategy,
    blockchain: Blockchain.POLYGON,
    assetType: AssetType.COIN,
    isToken: false,
    feeAssetGetter: 'getPolygonCoin',
  },
  {
    name: 'PolygonTokenStrategy',
    Strategy: PolygonTokenStrategy,
    blockchain: Blockchain.POLYGON,
    assetType: AssetType.TOKEN,
    isToken: true,
    feeAssetGetter: 'getPolygonCoin',
  },
  {
    name: 'SepoliaCoinStrategy',
    Strategy: SepoliaCoinStrategy,
    blockchain: Blockchain.SEPOLIA,
    assetType: AssetType.COIN,
    isToken: false,
    feeAssetGetter: 'getSepoliaCoin',
  },
  {
    name: 'SepoliaTokenStrategy',
    Strategy: SepoliaTokenStrategy,
    blockchain: Blockchain.SEPOLIA,
    assetType: AssetType.TOKEN,
    isToken: true,
    feeAssetGetter: 'getSepoliaCoin',
  },
];

describe('Payout EVM strategies (table-driven)', () => {
  describe.each(cases)('$name', ({ Strategy, blockchain, assetType, isToken, feeAssetGetter }) => {
    let service: EvmServiceMock;
    let assetService: AssetService;
    let payoutOrderRepo: PayoutOrderRepository;
    let strategy: EvmStrategy;

    beforeEach(() => {
      service = createEvmServiceMock();
      assetService = mock<AssetService>();
      payoutOrderRepo = mock<PayoutOrderRepository>();
      strategy = new Strategy(service as any, assetService, payoutOrderRepo);
    });

    it('exposes the expected blockchain', () => {
      expect(strategy.blockchain).toBe(blockchain);
    });

    it(`exposes assetType ${isToken ? 'TOKEN' : 'COIN'}`, () => {
      expect(strategy.assetType).toBe(assetType);
    });

    it('dispatchPayout broadcasts via the correct service method with a fresh (undefined) nonce', async () => {
      // No payoutTxId → getOrderNonce short-circuits to undefined (no nonce reuse), so the send is
      // called with an undefined nonce.
      const order = createCustomPayoutOrder({
        payoutTxId: null,
        destinationAddress: 'DEST_ADDR',
        amount: 1.23,
        asset: createCustomAsset({ dexName: 'PAYOUT_TOKEN' }),
      });
      const send = isToken ? service.sendToken : service.sendNativeCoin;
      send.mockResolvedValue('TX_BROADCASTED');

      const result = await (strategy as any).dispatchPayout(order);

      expect(result).toBe('TX_BROADCASTED');
      if (isToken) {
        expect(service.sendToken).toHaveBeenCalledWith(order.destinationAddress, order.asset, order.amount, undefined);
        expect(service.sendNativeCoin).not.toHaveBeenCalled();
      } else {
        expect(service.sendNativeCoin).toHaveBeenCalledWith(order.destinationAddress, order.amount, undefined);
        expect(service.sendToken).not.toHaveBeenCalled();
      }
    });

    it('getCurrentGasForTransaction delegates to the correct gas estimation method', async () => {
      const token: Asset = createCustomAsset({ dexName: 'GAS_TOKEN' });
      const gas = isToken ? service.getCurrentGasForTokenTransaction : service.getCurrentGasForCoinTransaction;
      gas.mockResolvedValue(0.00042);

      const result = await (strategy as any).getCurrentGasForTransaction(token);

      expect(result).toBe(0.00042);
      if (isToken) {
        expect(service.getCurrentGasForTokenTransaction).toHaveBeenCalledWith(token);
        expect(service.getCurrentGasForCoinTransaction).not.toHaveBeenCalled();
      } else {
        expect(service.getCurrentGasForCoinTransaction).toHaveBeenCalledWith();
        expect(service.getCurrentGasForTokenTransaction).not.toHaveBeenCalled();
      }
    });

    it(`getFeeAsset resolves the fee asset via assetService.${feeAssetGetter}()`, async () => {
      const feeAsset: Asset = createCustomAsset({ dexName: 'FEE_ASSET' });
      const getter = assetService[feeAssetGetter] as jest.Mock;
      getter.mockResolvedValue(feeAsset);

      const result = await (strategy as any).getFeeAsset();

      expect(result).toBe(feeAsset);
      expect(getter).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Payout EVM exact on-chain send capture (#4287 stage 1)', () => {
  function setup(Strategy: EvmStrategyCtor = EthereumTokenStrategy) {
    const service = createEvmServiceMock();
    const assetService = mock<AssetService>();
    const payoutOrderRepo = mock<PayoutOrderRepository>();
    jest.spyOn(payoutOrderRepo, 'update').mockResolvedValue({ affected: 1 } as any);
    jest.spyOn(payoutOrderRepo, 'save').mockImplementation(async (o) => o as any);
    service.sendToken.mockResolvedValue('TX_HASH');
    service.sendNativeCoin.mockResolvedValue('TX_HASH');
    return { strategy: new Strategy(service as any, assetService, payoutOrderRepo) };
  }

  it('captures the wei that actually left custody (full 18-dp) into amountBaseUnits, differing from the 8-dp derived value', async () => {
    const { strategy } = setup();
    const order = createCustomPayoutOrder({
      status: PayoutOrderStatus.PREPARATION_CONFIRMED,
      payoutTxId: null,
      amount: 0.1234567891, // > 8 dp: the derived path rounds to 8 dp, the on-chain wei keeps all 18
      asset: createCustomAsset({ decimals: 18 }),
    });

    await strategy.doPayout([order]);

    expect(order.amountBaseUnits).toBe(123456789100000000n); // exact wei = toWeiAmount(0.1234567891, 18)
    expect(order.amountBaseUnits).not.toBe(toBaseUnits(0.1234567891, 18)); // the 8-dp derived value differs
  });

  it('leaves amountBaseUnits null (fail-open) when the payout asset decimals are unknown', async () => {
    const { strategy } = setup();
    const order = createCustomPayoutOrder({
      status: PayoutOrderStatus.PREPARATION_CONFIRMED,
      payoutTxId: null,
      amount: 1,
      asset: createCustomAsset({ decimals: null as any }),
    });

    await strategy.doPayout([order]);

    expect(order.amountBaseUnits).toBeNull(); // no decimals → derive downstream (fail-open)
  });

  it('captures a native-coin payout at 18 dp — equals what parseEther broadcasts, full precision', async () => {
    const { strategy } = setup(EthereumCoinStrategy);
    const order = createCustomPayoutOrder({
      status: PayoutOrderStatus.PREPARATION_CONFIRMED,
      payoutTxId: null,
      amount: 0.1234567891, // > 8 dp: kept in full, matching the on-chain parseEther value
      asset: createCustomAsset({ decimals: 18 }),
    });

    await strategy.doPayout([order]);

    expect(order.amountBaseUnits).toBe(123456789100000000n); // = parseEther(0.1234567891)
  });

  it('does NOT capture a native-coin payout whose asset decimals ≠ 18 (broadcast is parseEther/18) — fail-open null', async () => {
    const { strategy } = setup(EthereumCoinStrategy);
    const order = createCustomPayoutOrder({
      status: PayoutOrderStatus.PREPARATION_CONFIRMED,
      payoutTxId: null,
      amount: 1,
      asset: createCustomAsset({ decimals: 8 }), // misconfigured coin — broadcast still parseEther/18
    });

    await strategy.doPayout([order]);

    expect(order.amountBaseUnits).toBeNull(); // a divergent value must not be stored → derive instead
  });
});
