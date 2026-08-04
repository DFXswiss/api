import { createMock } from '@golevelup/ts-jest';
import { AlchemyWebhookDto } from 'src/integration/alchemy/dto/alchemy-webhook.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetRepository } from 'src/shared/models/asset/asset.repository';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { Transaction } from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { CryptoInput, PayInStatus, PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInRepository } from 'src/subdomains/supporting/payin/repositories/payin.repository';
import { PayInBitcoinService } from 'src/subdomains/supporting/payin/services/payin-bitcoin.service';
import { PayInFiroService } from 'src/subdomains/supporting/payin/services/payin-firo.service';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { SendStrategyRegistry } from 'src/subdomains/supporting/payin/strategies/send/impl/base/send.strategy-registry';
import { IsNull, Not } from 'typeorm';
import { RegisterStrategyRegistry } from '../register.strategy-registry';
import { AlchemyStrategy } from '../alchemy.strategy';

const RECEIVER_ADDRESS = '0x1111111111111111111111111111111111111111';
const SENDER_ADDRESS = '0x2222222222222222222222222222222222222222';

class TestAlchemyStrategy extends AlchemyStrategy {
  protected readonly logger = new DfxLogger(TestAlchemyStrategy);
  private txType = PayInType.DEPOSIT;

  get blockchain(): Blockchain {
    return Blockchain.ETHEREUM;
  }

  configure(assetService: AssetService, payInService: PayInService): void {
    Reflect.set(this, 'assetService', assetService);
    Reflect.set(this, 'payInService', payInService);
  }

  setTxType(txType: PayInType): void {
    this.txType = txType;
  }

  process(dto: AlchemyWebhookDto): Promise<void> {
    return this.processWebhookTransactions(dto);
  }

  protected getOwnAddresses(): string[] {
    return [];
  }

  protected async getPayInAddresses(): Promise<string[]> {
    return [RECEIVER_ADDRESS];
  }

  protected getTxType(): PayInType {
    return this.txType;
  }
}

function createNftWebhook(
  category: string,
  rawValue: string,
  markers?: { erc721TokenId?: string; erc1155Metadata?: { tokenId: string; value: string }[] },
): AlchemyWebhookDto {
  return {
    webhookId: 'webhook-1',
    id: `event-nft-${category}`,
    createdAt: '2026-08-04T00:00:00.000Z',
    type: 'ADDRESS_ACTIVITY',
    event: {
      network: 'ETH_MAINNET',
      activity: [
        {
          fromAddress: SENDER_ADDRESS,
          toAddress: RECEIVER_ADDRESS,
          blockNum: '0x10',
          hash: `0x${'b'.repeat(64)}`,
          value: undefined as unknown as number,
          asset: undefined as unknown as string,
          category,
          ...markers,
          rawContract: {
            rawValue,
            decimals: undefined as unknown as number,
            address: '0xbd22475fbce80e181af62418be9786f8443de3e4',
          },
        },
      ],
    },
  };
}

function createWebhook(chainId: string, decimals: number): AlchemyWebhookDto {
  return {
    webhookId: 'webhook-1',
    id: `event-${chainId}`,
    createdAt: '2026-07-15T00:00:00.000Z',
    type: 'ADDRESS_ACTIVITY',
    event: {
      network: 'ETH_MAINNET',
      activity: [
        {
          fromAddress: SENDER_ADDRESS,
          toAddress: RECEIVER_ADDRESS,
          blockNum: '0x10',
          hash: `0x${'a'.repeat(64)}`,
          value: 1,
          asset: 'TOKEN',
          category: 'erc20',
          rawContract: {
            rawValue: `0x${(10n ** BigInt(decimals)).toString(16)}`,
            decimals,
            address: chainId,
          },
        },
      ],
    },
  };
}

describe('AlchemyStrategy priced pay-in boundary', () => {
  let storedPayIns: CryptoInput[];
  let assetService: AssetService;
  let payInService: PayInService;
  let payInRepository: PayInRepository;
  let paymentLinkPaymentService: PaymentLinkPaymentService;
  let strategy: TestAlchemyStrategy;

  beforeEach(() => {
    storedPayIns = [];

    const assetRepository = createMock<AssetRepository>();
    assetService = new AssetService(assetRepository);

    payInRepository = createMock<PayInRepository>();
    jest.spyOn(payInRepository, 'exists').mockResolvedValue(false);
    jest.spyOn(payInRepository, 'save').mockImplementation(async (payIn: CryptoInput) => {
      if (!storedPayIns.includes(payIn)) storedPayIns.push(payIn);
      return payIn;
    });
    jest
      .spyOn(payInRepository, 'find')
      .mockImplementation(async () => storedPayIns.filter((payIn) => payIn.status === PayInStatus.CREATED));

    const transactionService = createMock<TransactionService>();
    jest
      .spyOn(transactionService, 'create')
      .mockResolvedValue({ id: storedPayIns.length + 1 } as unknown as Transaction);

    paymentLinkPaymentService = createMock<PaymentLinkPaymentService>();
    payInService = new PayInService(
      payInRepository,
      createMock<RegisterStrategyRegistry>(),
      createMock<SendStrategyRegistry>(),
      transactionService,
      paymentLinkPaymentService,
      createMock<PayInBitcoinService>(),
      createMock<PayInFiroService>(),
      createMock<NotificationService>(),
    );

    strategy = new TestAlchemyStrategy();
    strategy.configure(assetService, payInService);
  });

  it('creates a processable ONDO input when the priced asset is present', async () => {
    const ondo = Object.assign(new Asset(), {
      id: 398,
      name: 'ONDO',
      uniqueName: 'Ethereum/ONDO',
      blockchain: Blockchain.ETHEREUM,
      type: AssetType.TOKEN,
      chainId: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',
      decimals: 18,
      priceRule: { id: 60 },
    });
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([ondo]);

    await strategy.process(createWebhook(ondo.chainId, ondo.decimals));

    expect(storedPayIns).toHaveLength(1);
    expect(storedPayIns.at(0)).toMatchObject({ asset: ondo, status: PayInStatus.CREATED });
    await expect(payInService.getNewPayIns()).resolves.toEqual(storedPayIns);
  });

  it('skips an ERC-1155 spam mint whose raw event data would parse as an absurd amount', async () => {
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([]);

    // TransferSingle event data: tokenId=1 ++ value=1 — read as one integer this is (2^256 + 1) wei
    const tokenIdPlusValue = `0x${'1'.padStart(64, '0')}${'1'.padStart(64, '0')}`;

    await strategy.process(createNftWebhook('erc1155', tokenIdPlusValue));

    expect(storedPayIns).toHaveLength(0);
  });

  it('skips an ERC-721 transfer regardless of category casing', async () => {
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([]);

    await strategy.process(createNftWebhook('ERC721', `0x${'f'.repeat(64)}`));

    expect(storedPayIns).toHaveLength(0);
  });

  it('skips a specialnft transfer', async () => {
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([]);

    await strategy.process(createNftWebhook('specialnft', '0x1'));

    expect(storedPayIns).toHaveLength(0);
  });

  it('skips an ERC-721 delivered under the collective token category', async () => {
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([]);

    await strategy.process(createNftWebhook('token', `0x${'f'.repeat(64)}`, { erc721TokenId: '0x2a' }));

    expect(storedPayIns).toHaveLength(0);
  });

  it('skips an ERC-1155 delivered under the collective token category', async () => {
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([]);

    await strategy.process(
      createNftWebhook('token', `0x${'1'.padStart(64, '0')}${'1'.padStart(64, '0')}`, {
        erc1155Metadata: [{ tokenId: '0x1', value: '0x1' }],
      }),
    );

    expect(storedPayIns).toHaveLength(0);
  });

  it('still registers a fungible transfer delivered under the collective token category', async () => {
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([]);

    await strategy.process(createNftWebhook('token', `0x${(10n ** 8n).toString(16)}`));

    expect(storedPayIns).toHaveLength(1);
    expect(storedPayIns.at(0)).toMatchObject({ asset: null, status: PayInStatus.FAILED });
  });

  it('stores an inert unpriced DGC input as FAILED and never returns it for processing', async () => {
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([]);

    await strategy.process(createWebhook('0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f', 8));

    expect(storedPayIns).toHaveLength(1);
    expect(storedPayIns.at(0)).toMatchObject({ asset: null, status: PayInStatus.FAILED });
    await expect(payInService.getNewPayIns()).resolves.toEqual([]);
  });

  it('stores an inert unpriced DSC input as FAILED and never returns it for processing', async () => {
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([]);

    await strategy.process(createWebhook('0x5d4e735784293a0a8d37761ad93c13a0dd35c7e7', 8));

    expect(storedPayIns).toHaveLength(1);
    expect(storedPayIns.at(0)).toMatchObject({ asset: null, status: PayInStatus.FAILED });
    await expect(payInService.getNewPayIns()).resolves.toEqual([]);
  });

  it('never resurrects an unpriced payment through the failed-payment retry', async () => {
    strategy.setTxType(PayInType.PAYMENT);
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([]);

    await strategy.process(createWebhook('0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f', 8));

    const find = jest.spyOn(payInRepository, 'find').mockResolvedValue(storedPayIns);
    const retryQuote = jest.spyOn(paymentLinkPaymentService, 'getPaymentQuoteByFailedCryptoInput');

    await payInService.updateFailedPayments();

    expect(find).toHaveBeenCalledWith({
      where: expect.objectContaining({ asset: { priceRule: Not(IsNull()) } }),
      relations: { asset: { priceRule: true } },
    });
    expect(retryQuote).not.toHaveBeenCalled();
    expect(storedPayIns.at(0)).toMatchObject({ asset: null, status: PayInStatus.FAILED });
  });

  it('still retries a failed payment whose asset remains priced', async () => {
    const ondo = Object.assign(new Asset(), {
      id: 398,
      name: 'ONDO',
      uniqueName: 'Ethereum/ONDO',
      blockchain: Blockchain.ETHEREUM,
      type: AssetType.TOKEN,
      chainId: '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',
      decimals: 18,
      priceRule: { id: 60 },
    });
    strategy.setTxType(PayInType.PAYMENT);
    jest.spyOn(assetService, 'getPayInAssets').mockResolvedValue([ondo]);
    jest.spyOn(paymentLinkPaymentService, 'getPaymentQuoteByCryptoInput').mockRejectedValue(new Error('quote pending'));

    await strategy.process(createWebhook(ondo.chainId, ondo.decimals));
    expect(storedPayIns.at(0)).toMatchObject({ asset: ondo, status: PayInStatus.FAILED });

    jest.spyOn(payInRepository, 'find').mockResolvedValue([...storedPayIns]);
    const payment = new PaymentLinkPayment();
    const quote = Object.assign(new PaymentQuote(), { payment });
    const retryQuote = jest
      .spyOn(paymentLinkPaymentService, 'getPaymentQuoteByFailedCryptoInput')
      .mockResolvedValue(quote);

    await payInService.updateFailedPayments();

    const retriedPayIn = storedPayIns.at(0)!;
    expect(retryQuote).toHaveBeenCalledTimes(1);
    expect(retryQuote.mock.calls.at(0)?.at(0)).toBe(retriedPayIn);
    expect(retriedPayIn.asset).toBe(ondo);
    expect(retriedPayIn.paymentLinkPayment).toBe(payment);
    expect(retriedPayIn.paymentQuote).toBe(quote);
    expect(retriedPayIn.status).toBe(PayInStatus.CREATED);
  });
});
