import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { RawTransaction } from 'src/integration/blockchain/bitcoin/node/rpc/bitcoin-rpc-types';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { Util } from 'src/shared/utils/util';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PaymentQuoteRepository } from '../../repositories/payment-quote.repository';
import { PaymentQuoteService } from '../payment-quote.service';
import { PaymentLinkFeeService } from '../payment-link-fee.service';
import { C2BPaymentLinkService } from '../c2b-payment-link.service';
import { PaymentBalanceService } from '../payment-balance.service';
import { TxValidationService } from 'src/integration/blockchain/shared/services/tx-validation.service';
import { PaymentQuote } from '../../entities/payment-quote.entity';
import { PaymentQuoteStatus } from '../../enums';
import * as ConfigModule from 'src/config/config';

const PAYMENT_ADDRESS = 'aFiroPaymentAddress123';
const TX_ID = 'abc123def456';

function createRawTx(overrides: Partial<RawTransaction> = {}): RawTransaction {
  return {
    txid: TX_ID,
    hash: TX_ID,
    version: 2,
    size: 225,
    vsize: 225,
    weight: 900,
    locktime: 0,
    vin: [],
    vout: [
      {
        value: 1.5,
        n: 0,
        scriptPubKey: {
          asm: '',
          hex: '',
          type: 'pubkeyhash',
          addresses: [PAYMENT_ADDRESS],
        },
      },
    ],
    confirmations: 0,
    ...overrides,
  };
}

function createQuoteMock(activations?: PaymentQuote['activations']): PaymentQuote {
  const quote = new PaymentQuote();
  quote.uniqueId = 'test-quote-1';
  quote.status = PaymentQuoteStatus.TX_RECEIVED;
  quote.activations = activations ?? null;
  return quote;
}

describe('PaymentQuoteService - doFiroTxIdPayment', () => {
  let service: PaymentQuoteService;
  let blockchainRegistryService: BlockchainRegistryService;
  let mockGetRawTx: jest.Mock;

  beforeAll(() => {
    // reduce retry count and eliminate delay for fast tests
    (ConfigModule as Record<string, unknown>).Config = {
      payment: { defaultFiroTxIdPaymentTryCount: 2 },
    };
    jest.spyOn(Util, 'delay').mockResolvedValue(undefined as never);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    mockGetRawTx = jest.fn();

    blockchainRegistryService = createMock<BlockchainRegistryService>();
    jest.spyOn(blockchainRegistryService, 'getClient').mockReturnValue({
      getRawTx: mockGetRawTx,
    } as never);

    const paymentBalanceService = createMock<PaymentBalanceService>();
    jest.spyOn(paymentBalanceService, 'getDepositAddress').mockReturnValue(PAYMENT_ADDRESS);

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        PaymentQuoteService,
        { provide: PaymentQuoteRepository, useValue: createMock<PaymentQuoteRepository>() },
        { provide: BlockchainRegistryService, useValue: blockchainRegistryService },
        { provide: AssetService, useValue: createMock<AssetService>() },
        { provide: PricingService, useValue: createMock<PricingService>() },
        { provide: PaymentLinkFeeService, useValue: createMock<PaymentLinkFeeService>() },
        { provide: C2BPaymentLinkService, useValue: createMock<C2BPaymentLinkService>() },
        { provide: PaymentBalanceService, useValue: paymentBalanceService },
        { provide: TxValidationService, useValue: createMock<TxValidationService>() },
        { provide: InternetComputerService, useValue: createMock<InternetComputerService>() },
      ],
    }).compile();

    service = module.get<PaymentQuoteService>(PaymentQuoteService);
  });

  it('should set txInMempool when TX found with 0 confirmations', async () => {
    const rawTx = createRawTx({ confirmations: 0 });
    mockGetRawTx.mockResolvedValueOnce(rawTx);

    const quote = createQuoteMock();
    await service['doFiroTxIdPayment'](TX_ID, quote);

    expect(quote.status).toBe(PaymentQuoteStatus.TX_MEMPOOL);
    expect(quote.txId).toBe(TX_ID);
  });

  it('should set txInBlockchain when TX found with confirmations > 0', async () => {
    const rawTx = createRawTx({ confirmations: 3 });
    mockGetRawTx.mockResolvedValueOnce(rawTx);

    const quote = createQuoteMock();
    await service['doFiroTxIdPayment'](TX_ID, quote);

    expect(quote.status).toBe(PaymentQuoteStatus.TX_BLOCKCHAIN);
    expect(quote.txId).toBe(TX_ID);
  });

  it('should fail when TX does not pay to payment address', async () => {
    const rawTx = createRawTx();
    rawTx.vout[0].scriptPubKey.addresses = ['someOtherAddress'];
    mockGetRawTx.mockResolvedValueOnce(rawTx);

    const quote = createQuoteMock();
    await service['doFiroTxIdPayment'](TX_ID, quote);

    expect(quote.status).toBe(PaymentQuoteStatus.TX_FAILED);
    expect(quote.errorMessage).toContain('does not pay to payment address');
  });

  it('should fail on amount mismatch', async () => {
    const rawTx = createRawTx(); // vout[0].value = 1.5
    mockGetRawTx.mockResolvedValueOnce(rawTx);

    const activations = [
      { method: Blockchain.FIRO, asset: { type: AssetType.COIN }, amount: 2.0 },
    ] as PaymentQuote['activations'];

    const quote = createQuoteMock(activations);
    await service['doFiroTxIdPayment'](TX_ID, quote);

    expect(quote.status).toBe(PaymentQuoteStatus.TX_FAILED);
    expect(quote.errorMessage).toContain('Amount mismatch');
    expect(quote.errorMessage).toContain('1.5');
    expect(quote.errorMessage).toContain('2');
  });

  it('should succeed when amount matches within tolerance', async () => {
    const rawTx = createRawTx();
    rawTx.vout[0].value = 1.500000001; // within 0.00000001 tolerance
    mockGetRawTx.mockResolvedValueOnce(rawTx);

    const activations = [
      { method: Blockchain.FIRO, asset: { type: AssetType.COIN }, amount: 1.5 },
    ] as PaymentQuote['activations'];

    const quote = createQuoteMock(activations);
    await service['doFiroTxIdPayment'](TX_ID, quote);

    expect(quote.status).toBe(PaymentQuoteStatus.TX_MEMPOOL);
  });

  it('should succeed without amount check when no activation exists', async () => {
    const rawTx = createRawTx({ confirmations: 1 });
    mockGetRawTx.mockResolvedValueOnce(rawTx);

    const quote = createQuoteMock(); // no activations
    await service['doFiroTxIdPayment'](TX_ID, quote);

    expect(quote.status).toBe(PaymentQuoteStatus.TX_BLOCKCHAIN);
  });

  it('should throw when TX not found after all retries', async () => {
    mockGetRawTx.mockResolvedValue(undefined);

    const quote = createQuoteMock();
    await expect(service['doFiroTxIdPayment'](TX_ID, quote)).rejects.toThrow('not found on Firo node');
    expect(mockGetRawTx).toHaveBeenCalledTimes(2); // tryCount = 2
  });

  it('should retry and succeed on second attempt', async () => {
    const rawTx = createRawTx({ confirmations: 0 });
    mockGetRawTx.mockResolvedValueOnce(undefined);
    mockGetRawTx.mockResolvedValueOnce(rawTx);

    const quote = createQuoteMock();
    await service['doFiroTxIdPayment'](TX_ID, quote);

    expect(mockGetRawTx).toHaveBeenCalledTimes(2);
    expect(quote.status).toBe(PaymentQuoteStatus.TX_MEMPOOL);
  });

  it('should ignore activations for non-FIRO or non-COIN types', async () => {
    const rawTx = createRawTx(); // value = 1.5
    mockGetRawTx.mockResolvedValueOnce(rawTx);

    const activations = [
      { method: Blockchain.BITCOIN, asset: { type: AssetType.COIN }, amount: 99 },
      { method: Blockchain.FIRO, asset: { type: AssetType.TOKEN }, amount: 99 },
    ] as PaymentQuote['activations'];

    const quote = createQuoteMock(activations);
    await service['doFiroTxIdPayment'](TX_ID, quote);

    // no amount mismatch because no matching activation
    expect(quote.status).toBe(PaymentQuoteStatus.TX_MEMPOOL);
  });
});
