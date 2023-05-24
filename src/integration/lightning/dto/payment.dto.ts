export interface PaymentDto {
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
  };
  wallet_id: string;
  webhook: string;
  webhook_status: string;
}
