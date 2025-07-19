import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { Util } from 'src/shared/utils/util';
import { C2BWebhookResult } from 'src/subdomains/core/payment-link/share/c2b-payment-link.provider';
import { PayInType } from '../../../entities/crypto-input.entity';
import { PayInEntry } from '../../../interfaces';
import { PayInWebHookService } from '../../../services/payin-webhhook.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class KucoinPayStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(KucoinPayStrategy);

  private readonly depositWebhookMessageQueue: QueueHandler;

  constructor(readonly payInWebHookService: PayInWebHookService) {
    super();

    this.depositWebhookMessageQueue = new QueueHandler();

    this.payInWebHookService
      .getKucoinTransactionWebhookObservable()
      .subscribe((payWebhook) => this.processWebhookMessageQueue(payWebhook));
  }

  get blockchain(): Blockchain {
    return Blockchain.KUCOIN_PAY;
  }

  private processWebhookMessageQueue(payWebhook: C2BWebhookResult): void {
    this.depositWebhookMessageQueue
      .handle<void>(async () => this.processWebhookTransactions(payWebhook))
      .catch((e) => {
        this.logger.error(
          `Error while processing new pay-in entries with webhook dto ${JSON.stringify(payWebhook)}:`,
          e,
        );
      });
  }

  private async processWebhookTransactions(payWebhook: C2BWebhookResult): Promise<void> {
    const supportedAssets = await this.assetService.getAllBlockchainAssets([this.blockchain]);

    const payInEntry = this.mapKucoinTransaction(payWebhook, supportedAssets);

    if (payInEntry) {
      const log = this.createNewLogObject();
      await this.createPayInsAndSave([payInEntry], log);
    }
  }

  private mapKucoinTransaction(payWebhook: C2BWebhookResult, supportedAssets: Asset[]): PayInEntry | undefined {
    const data = payWebhook.metadata;

    const asset = supportedAssets.find((a) => Util.equalsIgnoreCase(data.orderCurrency, a.name));
    if (!asset) return;

    return {
      senderAddresses: data.payerUserId,
      receiverAddress: BlockchainAddress.create(null, this.blockchain),
      txId: payWebhook.providerOrderId,
      txType: PayInType.PAYMENT,
      blockHeight: null,
      amount: data.orderAmount,
      asset,
    };
  }
}
