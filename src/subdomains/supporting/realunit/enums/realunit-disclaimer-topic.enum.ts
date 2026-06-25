// The five legal-disclaimer steps the RealUnit app shows during onboarding, each
// versioned independently via the generic partner-consent mechanism. The string
// values are the wire contract with the app and the `topic` stored in
// `partner_consent`. The enum declaration order is the canonical wizard order in
// which missing steps are returned to the client.
export enum RealUnitDisclaimerTopic {
  DISCLAIMER_PART_1 = 'DisclaimerPart1',
  DISCLAIMER_PART_2 = 'DisclaimerPart2',
  REALUNIT_DOCUMENTS = 'RealUnitDocuments',
  AKTIONARIAT_DOCUMENTS = 'AktionariatDocuments',
  DFX_DOCUMENTS = 'DfxDocuments',
}
