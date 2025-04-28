export interface LnurlPayRequestDto {
  tag: string;
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  externalId?: string;
}

export interface LnurlpInvoiceDto {
  pr: string;
}

export interface LnurlpLinkDto {
  id?: string;
  wallet?: string;
  description: string;
  min: number;
  served_meta?: number;
  served_pr?: number;
  username?: string;
  domain?: string;
  webhook_url?: string;
  webhook_headers?: string;
  webhook_body?: string;
  success_text?: string;
  success_url?: string;
  currency?: string;
  comment_chars: number;
  max: number;
  fiat_base_multiplier: number;
  zaps?: boolean;
  lnurl?: string;
}

export interface LnurlpLinkUpdateDto {
  description: string;
  min: number;
  max: number;
  currency?: string;
  comment_chars: number;
  webhook_url?: string;
  webhook_headers?: string;
  webhook_body?: string;
  success_text?: string;
  success_url?: string;
  fiat_base_multiplier: number;
  username?: string;
  zaps?: boolean;
}

export interface LnurlpLinkRemoveDto {
  success: boolean;
}

export interface LnurlpTransactionDto {
  payment_hash: string;
  payment_request: string;
  amount: number;
  comment: string;
  webhook_data: string;
  lnurlp: string;
  body: string;
}
