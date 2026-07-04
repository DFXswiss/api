import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ConfigService, Configuration } from 'src/config/config';
import { Eip7702DelegationService } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { FeeLimitExceededException } from 'src/subdomains/supporting/payment/exceptions/fee-limit-exceeded.exception';
import { createCustomCryptoInput } from '../../../../../entities/__mocks__/crypto-input.entity.mock';
import { CryptoInput, PayInAction, PayInStatus } from '../../../../../entities/crypto-input.entity';
import { PayInRepository } from '../../../../../repositories/payin.repository';
import { PayInBitcoinBasedService } from '../../../../../services/base/payin-bitcoin-based.service';
import { PayInEvmService } from '../../../../../services/base/payin-evm.service';
import { PayInCardanoService } from '../../../../../services/payin-cardano.service';
import { PayInInternetComputerService } from '../../../../../services/payin-icp.service';
import { PayInSolanaService } from '../../../../../services/payin-solana.service';
import { PayInTronService } from '../../../../../services/payin-tron.service';
import { LightningStrategy } from '../../lightning.strategy';
import { MoneroStrategy } from '../../monero.strategy';
import { BitcoinBasedStrategy } from '../bitcoin-based.strategy';
import { CardanoStrategy } from '../cardano.strategy';
import { EvmCoinStrategy } from '../evm-coin.strategy';
import { EvmTokenStrategy } from '../evm.token.strategy';
import { InternetComputerStrategy } from '../icp.strategy';
import { SendGroup, SendStrategy, SendType } from '../send.strategy';
import { SolanaStrategy } from '../solana.strategy';
import { TronStrategy } from '../tron.strategy';
import { ZanoStrategy } from '../zano.strategy';

// initialize the global Config singleton so Config.blockchainReturnFeeBuffer is available
beforeAll(() => {
  new ConfigService(new Configuration());
});

function returnGroup(payIns: CryptoInput[]): SendGroup {
  return {
    account: { seed: 'seed', index: 0 } as any,
    sourceAddress: 'source',
    destinationAddress: 'dest',
    asset: Object.assign(new Asset(), { name: 'USDC', blockchain: Blockchain.ETHEREUM }),
    status: PayInStatus.TO_RETURN,
    payIns,
  };
}

// --- EVM COIN --- //

class TestEvmCoinStrategy extends EvmCoinStrategy {
  protected readonly logger = new DfxLogger(TestEvmCoinStrategy);

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create('forward', Blockchain.ETHEREUM);
  }
}

describe('EvmCoinStrategy return path', () => {
  let strategy: TestEvmCoinStrategy;
  let evmService: PayInEvmService;

  beforeEach(() => {
    evmService = createMock<PayInEvmService>();
    strategy = new TestEvmCoinStrategy(evmService, createMock<PayInRepository>());

    jest.spyOn(evmService, 'getGasCostForCoinTransaction').mockResolvedValue(0.01);
    jest.spyOn(evmService, 'sendNativeCoin').mockResolvedValue('0xreturn');
  });

  it('sends the live-fee-adjusted total and distributes it onto the pay-ins', async () => {
    const a = createCustomCryptoInput({ amount: 1, chargebackAmount: 1, action: PayInAction.RETURN });
    const b = createCustomCryptoInput({ amount: 1, chargebackAmount: 1, action: PayInAction.RETURN });

    await (strategy as any).dispatchSend(returnGroup([a, b]), SendType.RETURN, 0.005);

    // gasCost = max(0.01, 0.005) * 1.05 = 0.0105; total = min(2, 2 - 0.0105) = 1.9895
    expect(evmService.sendNativeCoin).toHaveBeenCalledWith(expect.anything(), 'dest', 1.9895);
    expect(Util.round(a.returnAmount + b.returnAmount, 12)).toBe(1.9895);
    expect(a.returnAmount).toBe(0.99475);
    expect(b.returnAmount).toBe(0.99475);
  });

  it('throws and does not send when the return is uneconomic', async () => {
    const a = createCustomCryptoInput({ amount: 0.001, chargebackAmount: 0.001, action: PayInAction.RETURN });

    await expect((strategy as any).dispatchSend(returnGroup([a]), SendType.RETURN, 0.005)).rejects.toThrow(
      FeeLimitExceededException,
    );
    expect(evmService.sendNativeCoin).not.toHaveBeenCalled();
  });

  it('keeps the forward path unchanged', async () => {
    const a = createCustomCryptoInput({ amount: 2, chargebackAmount: 1, action: PayInAction.FORWARD });

    await (strategy as any).dispatchSend(returnGroup([a]), SendType.FORWARD, 0.005);

    // amount = round(2 - max(0.01, 0.005) * 1.05, 12) = 1.9895
    expect(evmService.sendNativeCoin).toHaveBeenCalledWith(expect.anything(), 'dest', 1.9895);
    expect(a.returnAmount).toBeUndefined();
  });
});

// --- EVM TOKEN --- //

class TestEvmTokenStrategy extends EvmTokenStrategy {
  protected readonly logger = new DfxLogger(TestEvmTokenStrategy);

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create('forward', Blockchain.ETHEREUM);
  }
}

describe('EvmTokenStrategy return path', () => {
  let strategy: TestEvmTokenStrategy;
  let evmService: PayInEvmService;
  let delegationService: Eip7702DelegationService;

  beforeEach(() => {
    evmService = createMock<PayInEvmService>();
    delegationService = createMock<Eip7702DelegationService>();
    strategy = new TestEvmTokenStrategy(evmService, createMock<PayInRepository>(), delegationService);

    jest.spyOn(evmService, 'sendToken').mockResolvedValue('0xtoken');
    jest.spyOn(delegationService, 'transferTokenViaDelegation').mockResolvedValue('0xdelegated');
    jest
      .spyOn(strategy as any, 'getEstimatedForwardFee')
      .mockResolvedValue({ feeNativeAsset: 0.001, feeInputAsset: 0.02, maxFeeInputAsset: 100 });
  });

  it('sends the fee-adjusted total via the legacy token transfer', async () => {
    const a = createCustomCryptoInput({ amount: 1, chargebackAmount: 1, action: PayInAction.RETURN });
    const b = createCustomCryptoInput({ amount: 1, chargebackAmount: 1, action: PayInAction.RETURN });

    await (strategy as any).dispatchSend(returnGroup([a, b]), SendType.RETURN);

    // total = min(2, 2 - 0.02 * 1.05) = 1.979
    expect(evmService.sendToken).toHaveBeenCalledWith(expect.anything(), 'dest', expect.anything(), 1.979);
    expect(Util.round(a.returnAmount + b.returnAmount, 12)).toBe(1.979);
  });

  it('sends the fee-adjusted total via delegation and stores the return amounts', async () => {
    const a = createCustomCryptoInput({ amount: 1, chargebackAmount: 1, action: PayInAction.RETURN });
    const b = createCustomCryptoInput({ amount: 1, chargebackAmount: 1, action: PayInAction.RETURN });

    await (strategy as any).dispatchReturnViaDelegation(returnGroup([a, b]));

    expect(delegationService.transferTokenViaDelegation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'dest',
      1.979,
    );
    expect(Util.round(a.returnAmount + b.returnAmount, 12)).toBe(1.979);
    expect(a.returnTxId).toBe('0xdelegated');
  });

  it('does not send via delegation when the return is uneconomic', async () => {
    jest
      .spyOn(strategy as any, 'getEstimatedForwardFee')
      .mockResolvedValue({ feeNativeAsset: 0.001, feeInputAsset: 100, maxFeeInputAsset: 100 });

    const a = createCustomCryptoInput({ amount: 1, chargebackAmount: 1, action: PayInAction.RETURN });

    await (strategy as any).dispatchReturnViaDelegation(returnGroup([a]));

    expect(delegationService.transferTokenViaDelegation).not.toHaveBeenCalled();
    expect(a.returnAmount).toBeUndefined();
  });

  // FIX 2: token returns must fail closed when the live fee estimate is missing (would otherwise send ungedeckt)
  it('fails closed on the legacy token transfer when the live fee estimate is zero', async () => {
    jest
      .spyOn(strategy as any, 'getEstimatedForwardFee')
      .mockResolvedValue({ feeNativeAsset: 0, feeInputAsset: 0, maxFeeInputAsset: 0 });

    const a = createCustomCryptoInput({ amount: 1, chargebackAmount: 1, action: PayInAction.RETURN });

    await expect((strategy as any).dispatchSend(returnGroup([a]), SendType.RETURN)).rejects.toThrow(
      FeeLimitExceededException,
    );
    expect(evmService.sendToken).not.toHaveBeenCalled();
    expect(a.returnAmount).toBeUndefined();
  });

  it('fails closed via delegation when the live fee estimate is zero', async () => {
    jest
      .spyOn(strategy as any, 'getEstimatedForwardFee')
      .mockResolvedValue({ feeNativeAsset: 0, feeInputAsset: 0, maxFeeInputAsset: 0 });

    const a = createCustomCryptoInput({ amount: 1, chargebackAmount: 1, action: PayInAction.RETURN });

    await expect((strategy as any).dispatchReturnViaDelegation(returnGroup([a]))).rejects.toThrow(
      FeeLimitExceededException,
    );
    expect(delegationService.transferTokenViaDelegation).not.toHaveBeenCalled();
    expect(a.returnAmount).toBeUndefined();
  });
});

// --- PER-PAY-IN (TRON, representative for Solana/Tron/Cardano/ICP) --- //

class TestTronStrategy extends TronStrategy {
  protected readonly logger = new DfxLogger(TestTronStrategy);

  readonly sentAmounts: number[] = [];

  get blockchain(): Blockchain {
    return Blockchain.TRON;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create('forward', Blockchain.TRON);
  }

  protected async checkPreparation(): Promise<boolean> {
    return true;
  }

  protected async prepareSend(payIn: CryptoInput): Promise<void> {
    payIn.status = PayInStatus.PREPARED;
  }

  protected async sendTransfer(payIn: CryptoInput): Promise<string> {
    this.sentAmounts.push(payIn.sendingAmount);
    return 'OUT_TX';
  }
}

describe('per-pay-in strategy return path (Tron)', () => {
  let strategy: TestTronStrategy;

  function build(fee: { feeNativeAsset: number; feeInputAsset: number; maxFeeInputAsset: number }): void {
    strategy = new TestTronStrategy(createMock<PayInTronService>(), createMock<PayInRepository>());
    (strategy as any).assetService = createMock();
    jest.spyOn(strategy as any, 'getEstimatedForwardFee').mockResolvedValue(fee);
  }

  it('computes the live return amount, stores it and sends exactly that amount', async () => {
    build({ feeNativeAsset: 0.001, feeInputAsset: 0.02, maxFeeInputAsset: 100 });

    const payIn = createCustomCryptoInput({
      amount: 1,
      chargebackAmount: 1,
      action: PayInAction.RETURN,
      status: PayInStatus.TO_RETURN,
      destinationAddress: BlockchainAddress.create('dest', Blockchain.TRON),
    });

    await strategy.doSend([payIn], SendType.RETURN);

    // total = min(1, 1 - 0.02 * 1.05) = 0.979
    expect(payIn.returnAmount).toBe(0.979);
    expect(strategy.sentAmounts).toEqual([0.979]);
    expect(payIn.returnTxId).toBe('OUT_TX');
    expect(payIn.status).toBe(PayInStatus.RETURNED);
  });

  it('does not send and stays TO_RETURN when the return is uneconomic', async () => {
    build({ feeNativeAsset: 0.001, feeInputAsset: 5, maxFeeInputAsset: 100 });

    const payIn = createCustomCryptoInput({
      amount: 1,
      chargebackAmount: 1,
      action: PayInAction.RETURN,
      status: PayInStatus.TO_RETURN,
      destinationAddress: BlockchainAddress.create('dest', Blockchain.TRON),
    });

    await strategy.doSend([payIn], SendType.RETURN);

    expect(strategy.sentAmounts).toHaveLength(0);
    expect(payIn.returnAmount).toBeUndefined();
    expect(payIn.status).toBe(PayInStatus.TO_RETURN);
  });

  it('keeps the forward path unchanged (sends the full amount, no return amount)', async () => {
    build({ feeNativeAsset: 0.001, feeInputAsset: 0.01, maxFeeInputAsset: 100 });

    const payIn = createCustomCryptoInput({
      amount: 2,
      chargebackAmount: 1,
      action: PayInAction.FORWARD,
      status: PayInStatus.ACKNOWLEDGED,
      buyCrypto: { blockchainFee: 50 } as any,
      destinationAddress: BlockchainAddress.create('dest', Blockchain.TRON),
    });

    await strategy.doSend([payIn], SendType.FORWARD);

    expect(strategy.sentAmounts).toEqual([2]);
    expect(payIn.returnAmount).toBeUndefined();
  });
});

// --- UTXO (BITCOIN-BASED, sent amount passed explicitly) --- //

class TestBitcoinBasedStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(TestBitcoinBasedStrategy);

  get forwardRequired(): boolean {
    return true;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create('forward', Blockchain.BITCOIN);
  }

  async checkTransactionCompletion(): Promise<boolean> {
    return true;
  }
}

describe('UTXO strategy return path (bitcoin-based)', () => {
  let strategy: TestBitcoinBasedStrategy;
  let payInService: PayInBitcoinBasedService;

  function build(fee: { feeInputAsset: number; maxFeeInputAsset: number }): void {
    payInService = createMock<PayInBitcoinBasedService>();
    jest.spyOn(payInService, 'checkHealthOrThrow').mockResolvedValue(undefined);
    jest.spyOn(payInService, 'sendTransfer').mockResolvedValue({ outTxId: 'BTC_TX', feeAmount: 0.0001 });

    strategy = new TestBitcoinBasedStrategy(payInService, createMock<PayInRepository>());
    (strategy as any).assetService = createMock();
    jest.spyOn(strategy as any, 'getEstimatedForwardFee').mockResolvedValue(fee);
  }

  it('caps at the authorized amount, lets the client take the single fee, and stores the net output', async () => {
    build({ feeInputAsset: 0.0002, maxFeeInputAsset: 0.01 });

    const payIn = createCustomCryptoInput({
      amount: 0.1,
      chargebackAmount: 0.1,
      action: PayInAction.RETURN,
      status: PayInStatus.TO_RETURN,
      destinationAddress: BlockchainAddress.create('dest', Blockchain.BITCOIN),
    });

    await strategy.doSend([payIn], SendType.RETURN);

    // fee-from-output: pass min(chargeback, amount) = 0.1 WITHOUT pre-deducting the fee; the client deducts it once
    expect(payInService.sendTransfer).toHaveBeenCalledWith(payIn, 0.1);
    // returnAmount is the real net output = sent (0.1) - feeAmount (0.0001) = 0.0999
    expect(payIn.returnAmount).toBe(0.0999);
    expect(payIn.returnTxId).toBe('BTC_TX');
    expect(payIn.status).toBe(PayInStatus.RETURNED);
  });

  it('does not send when the return is uneconomic', async () => {
    build({ feeInputAsset: 0.2, maxFeeInputAsset: 0.01 });

    const payIn = createCustomCryptoInput({
      amount: 0.1,
      chargebackAmount: 0.1,
      action: PayInAction.RETURN,
      status: PayInStatus.TO_RETURN,
      destinationAddress: BlockchainAddress.create('dest', Blockchain.BITCOIN),
    });

    await strategy.doSend([payIn], SendType.RETURN);

    expect(payInService.sendTransfer).not.toHaveBeenCalled();
    expect(payIn.returnAmount).toBeUndefined();
  });

  it('keeps the forward path unchanged (sends the full amount)', async () => {
    build({ feeInputAsset: 0.0002, maxFeeInputAsset: 0.01 });

    const payIn = createCustomCryptoInput({
      amount: 0.1,
      chargebackAmount: 0.1,
      action: PayInAction.FORWARD,
      status: PayInStatus.ACKNOWLEDGED,
      buyCrypto: { blockchainFee: 50 } as any,
      destinationAddress: BlockchainAddress.create('dest', Blockchain.BITCOIN),
    });

    await strategy.doSend([payIn], SendType.FORWARD);

    expect(payInService.sendTransfer).toHaveBeenCalledWith(payIn, 0.1);
    expect(payIn.returnAmount).toBeUndefined();
  });
});

// --- PER-PAY-IN (SOLANA / CARDANO / ICP-COIN / ICP-TOKEN) --- //

type RecordingStrategy = SendStrategy & { readonly sentAmounts: number[] };

class TestSolanaStrategy extends SolanaStrategy {
  protected readonly logger = new DfxLogger(TestSolanaStrategy);

  readonly sentAmounts: number[] = [];

  get blockchain(): Blockchain {
    return Blockchain.SOLANA;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create('forward', Blockchain.SOLANA);
  }

  protected async checkPreparation(): Promise<boolean> {
    return true;
  }

  protected async prepareSend(payIn: CryptoInput): Promise<void> {
    payIn.status = PayInStatus.PREPARED;
  }

  protected async sendTransfer(payIn: CryptoInput): Promise<string> {
    this.sentAmounts.push(payIn.sendingAmount);
    return 'OUT_TX';
  }
}

class TestCardanoStrategy extends CardanoStrategy {
  protected readonly logger = new DfxLogger(TestCardanoStrategy);

  readonly sentAmounts: number[] = [];

  get blockchain(): Blockchain {
    return Blockchain.CARDANO;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create('forward', Blockchain.CARDANO);
  }

  protected async checkPreparation(): Promise<boolean> {
    return true;
  }

  protected async prepareSend(payIn: CryptoInput): Promise<void> {
    payIn.status = PayInStatus.PREPARED;
  }

  protected async sendTransfer(payIn: CryptoInput): Promise<string> {
    this.sentAmounts.push(payIn.sendingAmount);
    return 'OUT_TX';
  }
}

class TestIcpCoinStrategy extends InternetComputerStrategy {
  protected readonly logger = new DfxLogger(TestIcpCoinStrategy);

  readonly sentAmounts: number[] = [];

  get blockchain(): Blockchain {
    return Blockchain.INTERNET_COMPUTER;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create('forward', Blockchain.INTERNET_COMPUTER);
  }

  protected async checkPreparation(): Promise<boolean> {
    return true;
  }

  protected async prepareSend(payIn: CryptoInput): Promise<void> {
    payIn.status = PayInStatus.PREPARED;
  }

  protected async sendTransfer(payIn: CryptoInput): Promise<string> {
    this.sentAmounts.push(payIn.sendingAmount);
    return 'OUT_TX';
  }
}

class TestIcpTokenStrategy extends TestIcpCoinStrategy {
  get assetType(): AssetType {
    return AssetType.TOKEN;
  }
}

const perPayInReturnStrategies: { name: string; blockchain: Blockchain; make: () => RecordingStrategy }[] = [
  {
    name: 'Solana',
    blockchain: Blockchain.SOLANA,
    make: () => new TestSolanaStrategy(createMock<PayInSolanaService>(), createMock<PayInRepository>()),
  },
  {
    name: 'Cardano',
    blockchain: Blockchain.CARDANO,
    make: () => new TestCardanoStrategy(createMock<PayInCardanoService>(), createMock<PayInRepository>()),
  },
  {
    name: 'ICP coin',
    blockchain: Blockchain.INTERNET_COMPUTER,
    make: () => new TestIcpCoinStrategy(createMock<PayInInternetComputerService>(), createMock<PayInRepository>()),
  },
  {
    name: 'ICP token',
    blockchain: Blockchain.INTERNET_COMPUTER,
    make: () => new TestIcpTokenStrategy(createMock<PayInInternetComputerService>(), createMock<PayInRepository>()),
  },
];

describe.each(perPayInReturnStrategies)('per-pay-in strategy return path ($name)', ({ blockchain, make }) => {
  let strategy: RecordingStrategy;

  function build(fee: { feeNativeAsset: number; feeInputAsset: number; maxFeeInputAsset: number }): void {
    strategy = make();
    (strategy as any).assetService = createMock();
    jest.spyOn(strategy as any, 'getEstimatedForwardFee').mockResolvedValue(fee);
  }

  // Solana/ICP `continue` after preparation, so the actual send happens on the next cycle; two passes cover every shape
  async function runTwice(payIn: CryptoInput, type: SendType): Promise<void> {
    await strategy.doSend([payIn], type);
    await strategy.doSend([payIn], type);
  }

  it('computes the live return amount, stores it and sends exactly that amount', async () => {
    build({ feeNativeAsset: 0.001, feeInputAsset: 0.02, maxFeeInputAsset: 100 });

    const payIn = createCustomCryptoInput({
      amount: 1,
      chargebackAmount: 1,
      action: PayInAction.RETURN,
      status: PayInStatus.TO_RETURN,
      destinationAddress: BlockchainAddress.create('dest', blockchain),
    });

    await runTwice(payIn, SendType.RETURN);

    // total = min(1, 1 - 0.02 * 1.05) = 0.979
    expect(payIn.returnAmount).toBe(0.979);
    expect(strategy.sentAmounts).toEqual([0.979]);
    expect(payIn.returnTxId).toBe('OUT_TX');
    expect(payIn.status).toBe(PayInStatus.RETURNED);
  });

  it('does not send and stays TO_RETURN when the return is uneconomic', async () => {
    build({ feeNativeAsset: 0.001, feeInputAsset: 5, maxFeeInputAsset: 100 });

    const payIn = createCustomCryptoInput({
      amount: 1,
      chargebackAmount: 1,
      action: PayInAction.RETURN,
      status: PayInStatus.TO_RETURN,
      destinationAddress: BlockchainAddress.create('dest', blockchain),
    });

    await runTwice(payIn, SendType.RETURN);

    expect(strategy.sentAmounts).toHaveLength(0);
    expect(payIn.returnAmount).toBeUndefined();
    expect(payIn.status).toBe(PayInStatus.TO_RETURN);
  });

  it('keeps the forward path unchanged (sends the full amount, no return amount)', async () => {
    build({ feeNativeAsset: 0.001, feeInputAsset: 0.01, maxFeeInputAsset: 100 });

    const payIn = createCustomCryptoInput({
      amount: 2,
      chargebackAmount: 1,
      action: PayInAction.FORWARD,
      status: PayInStatus.ACKNOWLEDGED,
      buyCrypto: { blockchainFee: 50 } as any,
      destinationAddress: BlockchainAddress.create('dest', blockchain),
    });

    await runTwice(payIn, SendType.FORWARD);

    expect(strategy.sentAmounts).toEqual([2]);
    expect(payIn.returnAmount).toBeUndefined();
  });
});

// --- RETURN-ONLY FEE-ON-TOP (ZANO / MONERO / LIGHTNING) --- //

interface UtxoReturnService {
  checkHealthOrThrow(): Promise<void>;
  sendTransfer(payIn: CryptoInput, amount: number): Promise<{ outTxId: string; feeAmount: number }>;
}

class TestZanoStrategy extends ZanoStrategy {
  protected readonly logger = new DfxLogger(TestZanoStrategy);

  get blockchain(): Blockchain {
    return Blockchain.ZANO;
  }

  get forwardRequired(): boolean {
    return false;
  }
}

const utxoReturnStrategies: {
  name: string;
  blockchain: Blockchain;
  make: () => { strategy: SendStrategy; service: DeepMocked<UtxoReturnService> };
}[] = [
  {
    name: 'Zano',
    blockchain: Blockchain.ZANO,
    make: () => {
      const service = createMock<UtxoReturnService>();
      return { strategy: new TestZanoStrategy(service as any, createMock<PayInRepository>()), service };
    },
  },
  {
    name: 'Monero',
    blockchain: Blockchain.MONERO,
    make: () => {
      const service = createMock<UtxoReturnService>();
      return { strategy: new MoneroStrategy(service as any, createMock<PayInRepository>()), service };
    },
  },
  {
    name: 'Lightning',
    blockchain: Blockchain.LIGHTNING,
    make: () => {
      const service = createMock<UtxoReturnService>();
      return { strategy: new LightningStrategy(service as any, createMock<PayInRepository>()), service };
    },
  },
];

describe.each(utxoReturnStrategies)('return-only strategy return path ($name)', ({ blockchain, make }) => {
  let strategy: SendStrategy;
  let service: DeepMocked<UtxoReturnService>;

  function build(feeInputAsset: number): void {
    ({ strategy, service } = make());
    service.checkHealthOrThrow.mockResolvedValue(undefined);
    service.sendTransfer.mockResolvedValue({ outTxId: 'UTXO_TX', feeAmount: 0.0001 });
    (strategy as any).assetService = createMock();
    jest
      .spyOn(strategy as any, 'getEstimatedForwardFee')
      .mockResolvedValue({ feeNativeAsset: 0.001, feeInputAsset, maxFeeInputAsset: 0.01 });
  }

  it('sends the fee-adjusted amount and stores it as the return amount', async () => {
    build(0.0002);

    const payIn = createCustomCryptoInput({
      amount: 0.1,
      chargebackAmount: 0.1,
      action: PayInAction.RETURN,
      status: PayInStatus.TO_RETURN,
      destinationAddress: BlockchainAddress.create('dest', blockchain),
    });

    await strategy.doSend([payIn], SendType.RETURN);

    // fee-on-top: amount = min(0.1, 0.1 - 0.0002 * 1.05) = 0.09979
    expect(service.sendTransfer).toHaveBeenCalledWith(payIn, 0.09979);
    expect(payIn.returnAmount).toBe(0.09979);
    expect(payIn.returnTxId).toBe('UTXO_TX');
    expect(payIn.status).toBe(PayInStatus.RETURNED);
  });

  it('does not send when the return is uneconomic', async () => {
    build(0.2);

    const payIn = createCustomCryptoInput({
      amount: 0.1,
      chargebackAmount: 0.1,
      action: PayInAction.RETURN,
      status: PayInStatus.TO_RETURN,
      destinationAddress: BlockchainAddress.create('dest', blockchain),
    });

    await strategy.doSend([payIn], SendType.RETURN);

    expect(service.sendTransfer).not.toHaveBeenCalled();
    expect(payIn.returnAmount).toBeUndefined();
    expect(payIn.status).toBe(PayInStatus.TO_RETURN);
  });

  it('rejects a forward (no forwarding required)', async () => {
    build(0.0002);

    const payIn = createCustomCryptoInput({
      amount: 0.1,
      chargebackAmount: 0.1,
      action: PayInAction.FORWARD,
      status: PayInStatus.ACKNOWLEDGED,
      destinationAddress: BlockchainAddress.create('dest', blockchain),
    });

    await expect(strategy.doSend([payIn], SendType.FORWARD)).rejects.toThrow('not required to forward');
    expect(service.sendTransfer).not.toHaveBeenCalled();
  });
});
