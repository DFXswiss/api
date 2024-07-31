import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LnBitsTransactionWebhookDto } from 'src/integration/lightning/dto/lnbits.dto';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { QueueHandler } from 'src/shared/utils/queue-handler';
import { PayInEntry } from '../../../interfaces';
import { PayInWebHookService } from '../../../services/payin-webhhook.service';
import { RegisterStrategy } from './base/register.strategy';

@Injectable()
export class LightningStrategy extends RegisterStrategy {
  protected logger: DfxLogger = new DfxLogger(LightningStrategy);

  private readonly depositWebhookMessageQueue: QueueHandler;

  constructor(readonly payInWebHookService: PayInWebHookService) {
    super();

    this.depositWebhookMessageQueue = new QueueHandler();

    payInWebHookService
      .getLightningTransactionWebhookObservable()
      .subscribe((transaction) => this.processLightningTransactionMessageQueue(transaction));
  }

  get blockchain(): Blockchain {
    return Blockchain.LIGHTNING;
  }

  // --- MESSAGE QUEUE --- //
  private processLightningTransactionMessageQueue(transactionWebhook: LnBitsTransactionWebhookDto) {
    this.depositWebhookMessageQueue
      .handle<void>(async () => this.processLightningTransaction(transactionWebhook))
      .catch((e) => {
        this.logger.error('Error while processing transaction webhook data', e);
      });
  }

  async processLightningTransaction(transactionWebhook: LnBitsTransactionWebhookDto): Promise<void> {
    const log = this.createNewLogObject();

    const payInEntry = await this.createPayInEntry(transactionWebhook);

    await this.createPayInsAndSave([payInEntry], log);

    this.printInputLog(log, 'omitted', this.blockchain);
  }

  private async createPayInEntry(transactionWebhook: LnBitsTransactionWebhookDto): Promise<PayInEntry> {
    const asset = await this.assetService.getLightningCoin();

    return {
      address: BlockchainAddress.create(this.getAddress(transactionWebhook), this.blockchain),
      txId: transactionWebhook.transaction.paymentHash,
      txType: null,
      blockHeight: null,
      amount: LightningHelper.msatToBtc(transactionWebhook.transaction.amount),
      asset,
    };
  }

  private getAddress(transactionWebhook: LnBitsTransactionWebhookDto): string | null {
    return transactionWebhook.transaction.lnurlp
      ? LightningHelper.createEncodedLnurlp(transactionWebhook.transaction.lnurlp)
      : null;
  }
}
