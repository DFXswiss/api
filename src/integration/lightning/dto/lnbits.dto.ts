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
}

export interface LnBitsWalletPaymentDto {
  payment_hash: string;
  payment_request: string;
  checking_id: string;
  lnurl_response: string;
}
