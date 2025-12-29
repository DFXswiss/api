import { PayInType } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';

export interface LnBitsWalletDto {
  id: string;
  name: string;
  balance: number;
}

export interface LnBitsInvoiceDto {
  payment_hash: string;
  payment_request: string;
}

export interface LnBitsWalletPaymentParamsDto {
  amount: number;
  memo: string;
  expirySec: number;
  webhook: string;
  extra: {
    link: string;
    signature: string;
  };
}

export interface LnBitsWalletPaymentDto {
  payment_hash: string;
  payment_request: string;
  checking_id: string;
  lnurl_response: string;
}

export interface LnBitsTransactionDto {
  checking_id: string;
  pending: boolean;
  amount: number;
  fee: number;
  memo: string;
  time: number;
  bolt11: string;
  preimage: string;
  payment_hash: string;
  expiry: number;
  extra: {
    tag: string;
    link: string;
    extra: string;
    signature: string;
  };
  wallet_id: string;
  webhook: string;
  webhook_status: string;
}

export interface LnBitsTransactionWebhookDto {
  uniqueId: string;
  transaction: {
    txType: PayInType;
    paymentHash: string;
    amount: number;
    lnurlp: string;
  };
}
