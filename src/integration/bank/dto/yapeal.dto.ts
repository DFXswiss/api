export interface VibanReserveRequest {
  baseAccountIBAN: string;
  bban: string;
}

export interface VibanReserveResponse {
  accountUid: string;
  bban: string;
  expiresAt: string;
  iban: string;
}

export interface VibanProposalResponse {
  bban: string;
  iban: string;
}

export interface VibanListResponse {
  vIBANS: Array<{
    vIBAN: string;
    vQrIBAN?: string;
  }>;
}
