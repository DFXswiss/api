import { LnBitsTransactionDto, LnBitsTransactionWebhookDto } from './lnbits.dto';
import { LnurlpTransactionDto } from './lnurlp.dto';

export class LnBitsWebhookMapper {
  static mapDepositTransaction(uniqueId: string, transaction: LnurlpTransactionDto): LnBitsTransactionWebhookDto {
    return {
      uniqueId: uniqueId,
      transaction: {
        paymentHash: transaction.payment_hash,
        amount: transaction.amount,
        lnurlp: transaction.lnurlp,
      },
    };
  }

  static mapPaymentTransaction(uniqueId: string, transaction: LnBitsTransactionDto): LnBitsTransactionWebhookDto {
    return {
      uniqueId: uniqueId,
      transaction: {
        paymentHash: transaction.payment_hash,
        amount: transaction.amount,
        lnurlp: transaction.extra?.link,
      },
    };
  }
}
