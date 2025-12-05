import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { BankTx, BankTxIndicator } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import {
  YapealTransactionStatus,
  YapealTransactionType,
  YapealWebhookPayloadDto,
  YapealWebhookTransactionDto,
} from '../dto/yapeal-webhook.dto';

@Injectable()
export class YapealWebhookService {
  private readonly logger = new DfxLogger(YapealWebhookService);

  /**
   * Process incoming YAPEAL webhook
   * This handles transaction notifications from YAPEAL for VIBANs
   */
  async processWebhook(payload: YapealWebhookPayloadDto): Promise<void> {
    const { eventType, data } = payload;

    this.logger.info(`Processing YAPEAL webhook event: ${eventType}`);

    // Only process booked credit transactions (incoming payments)
    if (data.status !== YapealTransactionStatus.BOOKED) {
      this.logger.info(`Skipping non-booked transaction: ${data.transactionUid}`);
      return;
    }

    if (data.type !== YapealTransactionType.CREDIT) {
      this.logger.info(`Skipping non-credit transaction: ${data.transactionUid}`);
      return;
    }

    // Map YAPEAL transaction to BankTx format
    const bankTxData = this.mapToBankTx(data);

    this.logger.info(`Mapped YAPEAL transaction to BankTx format: ${JSON.stringify(bankTxData)}`);

    // TODO: Integrate with BankTxService to create BankTx entity
    // This requires importing BankTxService and handling the transaction
    // The BankTxService.create() method should be called here
    // Also need to look up the VirtualIban by IBAN to get the associated UserData
  }

  /**
   * Map YAPEAL transaction to BankTx partial
   */
  private mapToBankTx(data: YapealWebhookTransactionDto): Partial<BankTx> {
    return {
      accountServiceRef: `YAPEAL-${data.transactionUid}`,
      bookingDate: data.bookingDate ? new Date(data.bookingDate) : undefined,
      valueDate: data.valueDate ? new Date(data.valueDate) : undefined,
      amount: data.amount,
      currency: data.currency,
      creditDebitIndicator:
        data.type === YapealTransactionType.CREDIT ? BankTxIndicator.CREDIT : BankTxIndicator.DEBIT,
      name: data.counterpartyName,
      iban: data.counterpartyIban,
      accountIban: data.iban, // The VIBAN that received the payment
      bic: data.counterpartyBic,
      remittanceInfo: data.remittanceInfo,
      endToEndId: data.endToEndId,
      txRaw: JSON.stringify(data.rawData ?? data),
    };
  }
}
