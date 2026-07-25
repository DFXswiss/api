export enum ReceiveIbanStatus {
  // An IBAN DFX receives customer money on: either a collective account from the bank table, or a personal
  // deposit IBAN of the requesting account. Lifecycle state is irrelevant - a retired collective account and
  // an expired personal IBAN both received real customer money.
  DFX_IBAN = 'DfxIban',

  // The IBAN could not be attributed for this caller. This does NOT claim that the IBAN does not belong to
  // DFX: personal IBANs of other accounts are deliberately never checked, and an account merge leaves the
  // virtual_iban rows on the former account, so a customer's own older personal IBAN can land here as well.
  NOT_MATCHED = 'NotMatched',

  // The input is not a structurally valid IBAN (country, length or checksum), so there is nothing to look up.
  INVALID_IBAN = 'InvalidIban',

  // No collective account matched, and personal IBANs are only ever checked for the authenticated account, so
  // without a login the check stays incomplete. Never answered as NOT_MATCHED, which would overstate it.
  LOGIN_REQUIRED = 'LoginRequired',
}
