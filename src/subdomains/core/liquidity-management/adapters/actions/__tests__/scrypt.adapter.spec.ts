import { createMock } from '@golevelup/ts-jest';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ScryptTransactionStatus, ScryptWithdrawStatus } from 'src/integration/exchange/dto/scrypt.dto';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { LiquidityManagementAction } from '../../../entities/liquidity-management-action.entity';
import { LiquidityManagementOrder } from '../../../entities/liquidity-management-order.entity';
import { LiquidityManagementSystem } from '../../../enums';
import { OrderFailedException } from '../../../exceptions/order-failed.exception';
import { LiquidityManagementOrderRepository } from '../../../repositories/liquidity-management-order.repository';
import { ScryptAdapter, ScryptAdapterCommands } from '../scrypt.adapter';

describe('ScryptAdapter', () => {
  let adapter: ScryptAdapter;

  let scryptService: ScryptService;
  let dexService: DexService;
  let orderRepo: LiquidityManagementOrderRepository;
  let pricingService: PricingService;
  let assetService: AssetService;

  // The withdraw param parsing reads the destination address from an env var named by the param.
  const ADDRESS_ENV = 'TEST_SCRYPT_WITHDRAW_ADDRESS';
  const WITHDRAW_ADDRESS = '0xWithdrawTarget';
  const WITHDRAW_BLOCKCHAIN = Blockchain.ETHEREUM;

  beforeEach(() => {
    scryptService = createMock<ScryptService>();
    dexService = createMock<DexService>();
    orderRepo = createMock<LiquidityManagementOrderRepository>();
    pricingService = createMock<PricingService>();
    assetService = createMock<AssetService>();

    process.env[ADDRESS_ENV] = WITHDRAW_ADDRESS;

    adapter = new ScryptAdapter(scryptService, dexService, orderRepo, pricingService, assetService);
  });

  afterEach(() => {
    delete process.env[ADDRESS_ENV];
    jest.restoreAllMocks();
  });

  // --- HELPERS --- //

  function createWithdrawOrder(): LiquidityManagementOrder {
    const action = Object.assign(new LiquidityManagementAction(), {
      system: LiquidityManagementSystem.SCRYPT,
      command: ScryptAdapterCommands.WITHDRAW,
      params: JSON.stringify({
        destinationAddress: ADDRESS_ENV,
        destinationBlockchain: WITHDRAW_BLOCKCHAIN,
      }),
    });

    return Object.assign(new LiquidityManagementOrder(), {
      correlationId: 'cl-req-id-1',
      action,
    });
  }

  function mockWithdrawStatus(status: Partial<ScryptWithdrawStatus> | null): void {
    jest
      .spyOn(scryptService, 'getWithdrawalStatus')
      .mockResolvedValue(status === null ? null : (status as ScryptWithdrawStatus));
  }

  it('should be defined', () => {
    expect(adapter).toBeDefined();
  });

  // --- checkWithdrawCompletion (via checkCompletion) --- //

  it('should forward checkTransferCompletion result (true) for a completed withdrawal with a txHash', async () => {
    const order = createWithdrawOrder();
    mockWithdrawStatus({ id: 'tx-1', status: ScryptTransactionStatus.COMPLETED, txHash: '0xabc', amount: 5 });
    jest.spyOn(dexService, 'checkTransferCompletion').mockResolvedValue(true);

    await expect(adapter.checkCompletion(order)).resolves.toBe(true);

    expect(dexService.checkTransferCompletion).toHaveBeenCalledWith('0xabc', WITHDRAW_BLOCKCHAIN);
    expect(order.outputAmount).toBe(5);
  });

  it('should forward checkTransferCompletion result (false) for a completed withdrawal with a txHash', async () => {
    const order = createWithdrawOrder();
    mockWithdrawStatus({ id: 'tx-1', status: ScryptTransactionStatus.COMPLETED, txHash: '0xabc', amount: 5 });
    jest.spyOn(dexService, 'checkTransferCompletion').mockResolvedValue(false);

    await expect(adapter.checkCompletion(order)).resolves.toBe(false);

    expect(dexService.checkTransferCompletion).toHaveBeenCalledWith('0xabc', WITHDRAW_BLOCKCHAIN);
  });

  it('should return false without calling checkTransferCompletion when status lookup returns null', async () => {
    const order = createWithdrawOrder();
    mockWithdrawStatus(null);

    await expect(adapter.checkCompletion(order)).resolves.toBe(false);

    expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
  });

  it('should return false without calling checkTransferCompletion when the withdrawal has no txHash yet', async () => {
    const order = createWithdrawOrder();
    mockWithdrawStatus({ id: 'tx-1', status: ScryptTransactionStatus.COMPLETED, txHash: undefined });

    await expect(adapter.checkCompletion(order)).resolves.toBe(false);

    expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
  });

  it('should throw OrderFailedException when the withdrawal status is FAILED', async () => {
    const order = createWithdrawOrder();
    mockWithdrawStatus({
      id: 'tx-1',
      status: ScryptTransactionStatus.FAILED,
      txHash: '0xabc',
      rejectReason: 'insufficient',
      rejectText: 'not enough',
    });

    await expect(adapter.checkCompletion(order)).rejects.toThrow(OrderFailedException);
    expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
  });

  it('should throw OrderFailedException when the withdrawal status is REJECTED', async () => {
    const order = createWithdrawOrder();
    mockWithdrawStatus({ id: 'tx-1', status: ScryptTransactionStatus.REJECTED, txHash: '0xabc' });

    await expect(adapter.checkCompletion(order)).rejects.toThrow(OrderFailedException);
    expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
  });

  it('should return false (retry) when getWithdrawalStatus throws a transient WS error', async () => {
    const order = createWithdrawOrder();
    jest
      .spyOn(scryptService, 'getWithdrawalStatus')
      .mockRejectedValue(new Error('Connection closed before update received'));

    await expect(adapter.checkCompletion(order)).resolves.toBe(false);

    expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
  });

  it('should rethrow when getWithdrawalStatus throws a non-transient error', async () => {
    const order = createWithdrawOrder();
    jest.spyOn(scryptService, 'getWithdrawalStatus').mockRejectedValue(new Error('Unexpected fatal error'));

    await expect(adapter.checkCompletion(order)).rejects.toThrow('Unexpected fatal error');

    expect(dexService.checkTransferCompletion).not.toHaveBeenCalled();
  });

  it('should return false for an unsupported command without touching the scrypt service', async () => {
    const action = Object.assign(new LiquidityManagementAction(), {
      system: LiquidityManagementSystem.SCRYPT,
      command: 'unsupported',
    });
    const order = Object.assign(new LiquidityManagementOrder(), { action });

    await expect(adapter.checkCompletion(order)).resolves.toBe(false);
    expect(scryptService.getWithdrawalStatus).not.toHaveBeenCalled();
  });
});
