import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { LnBitsTransactionDto, LnBitsTransactionWebhookDto } from './lnbits.dto';
import { LnurlpTransactionDto } from './lnurlp.dto';

export class LnBitsWebhookMapper {
  static mapDepositTransaction(uniqueId: string, transaction: LnurlpTransactionDto): LnBitsTransactionWebhookDto {
    return {
      uniqueId,
      transaction: {
        txType: PayInType.DEPOSIT,
        paymentHash: transaction.payment_hash,
        amount: transaction.amount,
        lnurlp: transaction.lnurlp,
      },
    };
  }

  static mapPaymentTransaction(uniqueId: string, transaction: LnBitsTransactionDto): LnBitsTransactionWebhookDto {
    return {
      uniqueId,
      transaction: {
        txType: PayInType.PAYMENT,
        paymentHash: transaction.payment_hash,
        amount: transaction.amount,
        lnurlp: transaction.extra?.link,
      },
    };
  }
}
