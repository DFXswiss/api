import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { WebhookResult } from 'src/subdomains/core/payment-link/share/IPaymentLinkProvider';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInWebHookService } from '../../../services/payin-webhhook.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class BinancePayStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(BinancePayStrategy);

  private readonly depositWebhookMessageQueue: QueueHandler;

  constructor(readonly payInWebHookService: PayInWebHookService) {
    super();

    this.depositWebhookMessageQueue = new QueueHandler();

    this.payInWebHookService
      .getBinanceTransactionWebhookObservable()
      .subscribe((payWebhook) => this.processWebhookMessageQueue(payWebhook));
  }

  get blockchain(): Blockchain {
    return Blockchain.BINANCE_PAY;
  }

  private processWebhookMessageQueue(payWebhook: WebhookResult): void {
    this.depositWebhookMessageQueue
      .handle<void>(async () => this.processWebhookTransactions(payWebhook))
      .catch((e) => {
        this.logger.error(
          `Error while processing new pay-in entries with webhook dto ${JSON.stringify(payWebhook)}:`,
          e,
        );
      });
  }

  private async processWebhookTransactions(payWebhook: WebhookResult): Promise<void> {
    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    const payInEntries = this.mapBinanceTransaction(payWebhook, supportedAssets);

    if (payInEntries.length) {
      const log = this.createNewLogObject();
      await this.createPayInsAndSave(payInEntries, log);
    }
  }

  private mapBinanceTransaction(payWebhook: WebhookResult, supportedAssets: Asset[]): PayInEntry[] {
    try {
      const paymentInstructions = payWebhook.metadata['paymentInfo']['paymentInstructions'];

      return paymentInstructions
        .map((pi) => ({
          senderAddresses: null,
          receiverAddress: null,
          txId: payWebhook.providerOrderId,
          txType: PayInType.PAYMENT,
          blockHeight: null,
          amount: pi.amount,
          asset: supportedAssets.find((a) => Util.equalsIgnoreCase(pi.currency, a.name)),
        }))
        .filter((p) => p.asset);
    } catch (e) {
      this.logger.error(`Error while mapping binance transaction: ${JSON.stringify(payWebhook)}`, e);
    }
  }
}
