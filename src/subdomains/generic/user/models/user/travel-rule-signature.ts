/**
 * Shared fail-closed allowlist of known address-ownership signature formats for the Travel-Rule PDF
 * pipeline. Deliberately conservative so it never rejects a valid signature; the exact allowlist
 * scope is Compliance-sign-off-pending (open question Q1, DECISION_NEEDED).
 *
 * Empirical format distribution from the sheet `archiv!J` full scan (27.296 non-empty cells):
 * Monero base58, EVM hex (0x + 130/146 hex), Bitcoin base64 (`H…`, len ~88), Cardano CIP-30 COSE
 * (hex prefix `8458`, optionally with a `;<key>` suffix). A masterKey UUID is excluded explicitly —
 * it can never cryptographically prove address ownership (historically 9 worthless UUID
 * pseudo-signatures were uploaded with status TRUE).
 *
 * The job uses this to skip non-processable candidates without claiming them; the observer uses the
 * SAME check so its `backlog`/`oldestAgeHours` metrics only count drainable work and a separate
 * `skippedUnrecognised` metric tracks the permanently-skipped (non-allowlist) candidates. Keeping a
 * single source of truth here is what prevents the observer from raising false-positive stuck alerts
 * on candidates the job will never process (e.g. Lightning/DeFiChain).
 */
export class TravelRuleSignature {
  private static readonly UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  private static readonly SIGNATURE_FORMATS: RegExp[] = [
    /^0x[0-9a-fA-F]{130}$/, // EVM personal_sign (65-byte r/s/v)
    /^0x[0-9a-fA-F]{146}$/, // EVM long variant observed in the archive (73 bytes)
    /^8458[0-9a-fA-F]+$/, // Cardano CIP-8/CIP-30 COSE_Sign1 (CBOR), key part handled below
    /^[H-K][0-9A-Za-z+/]{86,88}={0,2}$/, // Bitcoin message signature, base64 (65 bytes → ~88 chars)
    /^[1-9A-HJ-NP-Za-km-z]{90,}$/, // Monero base58 (long, no 0/O/I/l)
  ];

  static isValid(signature?: string): boolean {
    if (!signature) return false;

    // a `;<key>` suffix (Cardano CIP-30) is verification-relevant — validate only the signature part
    const value = signature.split(';')[0];

    if (TravelRuleSignature.UUID_REGEX.test(value)) return false;

    return TravelRuleSignature.SIGNATURE_FORMATS.some((format) => format.test(value));
  }
}
