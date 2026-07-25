export enum ReceiveIbanStatus {
  // An IBAN that belongs to DFX: either a collective account from the bank table, or a personal deposit IBAN
  // of the requesting account. It does not say the account still accepts money - getReceiveIbanStatus ignores
  // the bank `receive` flag and every virtual_iban lifecycle state, so a long-closed account matches just as
  // well. Phrase the hint as "belongs to us", never as "pay in here".
  DFX_IBAN = 'DfxIban',

  // The IBAN could not be attributed for this caller. This does NOT claim that the IBAN does not belong to
  // DFX: personal IBANs of other accounts are deliberately never checked, and mergeUserData does not move
  // virtual_iban rows to the master, so a customer's own older personal IBAN can land here as well.
  NOT_MATCHED = 'NotMatched',

  // The input is not a structurally valid IBAN (country, length or checksum), so there is nothing to look up.
  INVALID_IBAN = 'InvalidIban',

  // No collective account matched, and personal IBANs are only ever checked for the authenticated account, so
  // without a login the check stays incomplete. Never answered as NOT_MATCHED, which would overstate it.
  // Tokens that carry no `account` claim get this too even though they are authenticated - company tokens
  // (generateCompanyToken) are wallet-scoped, not account-scoped. Not a case the support form produces.
  LOGIN_REQUIRED = 'LoginRequired',
}
