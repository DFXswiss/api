export interface LnurlWithdrawRequestDto {
  tag: string;
  callback: string;
  k1: string;
  minWithdrawable: number;
  maxWithdrawable: number;
  defaultDescription: string;
}

export interface LnurlwInvoiceDto {
  status: string;
  reason: string;
}

export interface LnurlwLinkDto {
  id?: string;
  wallet?: string;
  title: string;
  min_withdrawable: number;
  max_withdrawable: number;
  uses: number;
  wait_time: number;
  is_unique: boolean;
  unique_hash?: string;
  k1?: string;
  open_time?: number;
  used?: number;
  usescsv?: string;
  number?: number;
  webhook_url?: string;
  webhook_headers?: string;
  webhook_body?: string;
  custom_url?: string;
  lnurl?: string;
}

export interface LnurlwLinkRemoveDto {
  success: boolean;
}
