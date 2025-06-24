import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BinancePayWebhookDto } from 'src/integration/c2b-payment-link/binance/dto/binance.dto';
import { C2BPaymentLinkService } from 'src/integration/c2b-payment-link/services/c2b-payment-link.service';
import { WebhookResult } from 'src/integration/c2b-payment-link/share/IPaymentLinkProvider';
import { C2BPaymentStatus } from 'src/integration/c2b-payment-link/share/PaymentStatus';
import { C2BPaymentProvider } from 'src/integration/c2b-payment-link/share/providers.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInWebHookService } from '../../../services/payin-webhhook.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class BinanceStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(BinanceStrategy);

  private readonly depositWebhookMessageQueue: QueueHandler;

  constructor(
    readonly payInWebHookService: PayInWebHookService,
    private readonly c2bPaymentLinkService: C2BPaymentLinkService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
  ) {
    super();

    this.depositWebhookMessageQueue = new QueueHandler();

    this.payInWebHookService
      .getBinanceTransactionWebhookObservable()
      .subscribe((payWebhook) => this.processWebhookMessageQueue(payWebhook));
  }

  get blockchain(): Blockchain {
    return Blockchain.BINANCE_PAY;
  }

  private processWebhookMessageQueue(payWebhook: BinancePayWebhookDto): void {
    this.depositWebhookMessageQueue
      .handle<void>(async () => this.processWebhookTransactions(payWebhook))
      .catch((e) => {
        this.logger.error(
          `Error while processing new pay-in entries with webhook dto ${JSON.stringify(payWebhook)}:`,
          e,
        );
      });
  }

  private async processWebhookTransactions(payWebhook: BinancePayWebhookDto): Promise<void> {
    const result = await this.c2bPaymentLinkService.handleWebhook(C2BPaymentProvider.BINANCE_PAY, payWebhook);
    if (!result) return;

    switch (result.status) {
      case C2BPaymentStatus.COMPLETED:
        return this.processPaymentCompleted(result);

      case C2BPaymentStatus.WAITING:
        return this.paymentLinkPaymentService.handleBinanceWaiting(result);
    }
  }

  private async processPaymentCompleted(result: WebhookResult) {
    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    for (const supportedAsset of supportedAssets) {
      const payInEntry = this.mapBinanceTransaction(result, supportedAsset);

      if (payInEntry) {
        const log = this.createNewLogObject();
        await this.createPayInsAndSave([payInEntry], log);
      }
    }
  }

  private mapBinanceTransaction(result: WebhookResult, asset: Asset): PayInEntry | undefined {
    try {
      const transactionId = result.metadata['transactionId'] ?? result.providerOrderId;

      const paymentInstructions = result.metadata['paymentInfo']['paymentInstructions'];
      const paymentInstructionOfAsset = paymentInstructions.find((pi) =>
        Util.equalsIgnoreCase(pi.currency, asset.name),
      );
      if (!paymentInstructionOfAsset) return;

      return {
        senderAddresses: null,
        receiverAddress: null,
        txId: transactionId,
        txType: PayInType.PAYMENT,
        blockHeight: null,
        amount: paymentInstructionOfAsset.amount,
        asset: asset,
      };
    } catch (e) {
      this.logger.error(`Error while mapping binance transaction: ${JSON.stringify(result)}`, e);
    }
  }
}
