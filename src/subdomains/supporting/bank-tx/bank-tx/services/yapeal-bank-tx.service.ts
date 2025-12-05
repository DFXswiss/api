import { ConflictException, Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import {
  YapealTransactionStatus,
  YapealTransactionType,
  YapealWebhookPayloadDto,
  YapealWebhookTransactionDto,
} from 'src/integration/bank/dto/yapeal-webhook.dto';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { BankTxService } from './bank-tx.service';
import { BankTx, BankTxIndicator, BankTxType } from '../entities/bank-tx.entity';
import { SpecialExternalAccountService } from '../../../payment/services/special-external-account.service';

@Injectable()
export class YapealBankTxService {
  private readonly logger = new DfxLogger(YapealBankTxService);

  constructor(
    private readonly bankTxService: BankTxService,
    private readonly virtualIbanService: VirtualIbanService,
    private readonly specialAccountService: SpecialExternalAccountService,
  ) {}

  /**
   * Process incoming YAPEAL webhook and create BankTx
   */
  async processWebhook(payload: YapealWebhookPayloadDto): Promise<BankTx | null> {
    const { eventType, data } = payload;

    this.logger.info(`Processing YAPEAL webhook event: ${eventType}`);

    // Only process booked credit transactions (incoming payments)
    if (data.status !== YapealTransactionStatus.BOOKED) {
      this.logger.info(`Skipping non-booked transaction: ${data.transactionUid}`);
      return null;
    }

    if (data.type !== YapealTransactionType.CREDIT) {
      this.logger.info(`Skipping non-credit transaction: ${data.transactionUid}`);
      return null;
    }

    // Look up the VirtualIban to get associated UserData
    const virtualIban = await this.virtualIbanService.getByIban(data.iban);
    if (!virtualIban) {
      this.logger.warn(`No VirtualIban found for IBAN: ${data.iban}`);
      return null;
    }

    // Map YAPEAL transaction to BankTx format
    const bankTxData = this.mapToBankTx(data);

    this.logger.info(`Creating BankTx from YAPEAL transaction: ${data.transactionUid}`);

    try {
      const multiAccounts = await this.specialAccountService.getMultiAccounts();
      const savedTx = await this.bankTxService.create(bankTxData, multiAccounts);

      this.logger.info(`Created BankTx ${savedTx.id} from YAPEAL transaction ${data.transactionUid}`);

      return savedTx as BankTx;
    } catch (e) {
      if (e instanceof ConflictException) {
        this.logger.info(`YAPEAL transaction already exists: ${data.transactionUid}`);
        return null;
      }
      throw e;
    }
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
      type: BankTxType.BUY_CRYPTO, // Personal IBAN payments are for buying crypto
    };
  }
}
