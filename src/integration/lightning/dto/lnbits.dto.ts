export interface LnBitsWalletDto {
  id: string;
  name: string;
  balance: number;
}

export interface LnBitsInvoiceDto {
  payment_hash: string;
  payment_request: string;
}
