export interface LnurlPayRequestDto {
  tag: string;
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
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
  lnurl?: string;
}

export interface LnurlpLinkRemoveDto {
  success: boolean;
}
