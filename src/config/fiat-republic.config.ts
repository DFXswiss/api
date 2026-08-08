export interface FiatRepublicConfig {
  baseUrl: string;
  authUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  masterFiatAccountId: string;
  ibanCountry: string;
  enabled: boolean;
  bankTxSyncEnabled: boolean;
  frontendEnabled: boolean;
  payoutEnabled: boolean;
  payoutRoutingEnabled: boolean;
}

/**
 * Fiat Republic is deployed dark and switched on in stages. Two conditions gate everything:
 * complete credentials (`isConfigured`) AND the explicit `FIAT_REPUBLIC_ENABLED` release. With
 * either missing, the rail behaves exactly as if this integration did not exist — no HTTP call, no
 * cron work, no webhook accepted, no Fiat Republic bank offered or selected anywhere.
 *
 * On top of that master switch, each capability carries its own flag, so they can be released one
 * at a time and rolled back individually:
 *
 * - `bankTxSyncEnabled`     — ingest Fiat Republic payins into `bank_tx` (webhook + polling backstop).
 * - `frontendEnabled`       — offer Fiat Republic to customers at all: its collection IBAN via the
 *                             receive-IBAN path and personal IBANs (named sub-accounts) via the
 *                             virtual-IBAN provider. Off = customers never see a Fiat Republic IBAN.
 * - `payoutEnabled`         — transmit already-assigned fiat outputs to Fiat Republic. Only affects
 *                             rows whose bank is *already* Fiat Republic; it never re-routes anything.
 * - `payoutRoutingEnabled`  — let the payout bank selection pick Fiat Republic for new EUR outputs
 *                             instead of the incumbent Olkypay rail. Deliberately separate from
 *                             `payoutEnabled`: the rail is proven with manually assigned rows first,
 *                             and turning routing back off leaves in-flight rows untouched.
 *
 * `ibanCountry` is the only value with a default: DE is the EUR IBAN country DFX committed to
 * towards Fiat Republic. It is non-secret configuration and belongs in the compose `environment:`
 * block; everything else is either a secret (vault) or a release switch set deliberately per stage.
 */
export function buildFiatRepublicConfig(env: NodeJS.ProcessEnv): FiatRepublicConfig {
  return {
    baseUrl: env.FIAT_REPUBLIC_BASE_URL,
    authUrl: env.FIAT_REPUBLIC_AUTH_URL,
    clientId: env.FIAT_REPUBLIC_CLIENT_ID,
    clientSecret: env.FIAT_REPUBLIC_CLIENT_SECRET,
    webhookSecret: env.FIAT_REPUBLIC_WEBHOOK_SECRET,
    masterFiatAccountId: env.FIAT_REPUBLIC_MASTER_FIAT_ACCOUNT_ID,
    // Trimmed and emptiness-checked rather than `??`: an empty or blank value in a deploy file must
    // fall back to the committed default, not travel to Fiat Republic as an invalid ibanCountry.
    ibanCountry: env.FIAT_REPUBLIC_IBAN_COUNTRY?.trim() || 'DE',
    enabled: env.FIAT_REPUBLIC_ENABLED === 'true',
    bankTxSyncEnabled: env.FIAT_REPUBLIC_BANK_TX_SYNC_ENABLED === 'true',
    frontendEnabled: env.FIAT_REPUBLIC_FRONTEND_ENABLED === 'true',
    payoutEnabled: env.FIAT_REPUBLIC_PAYOUT_ENABLED === 'true',
    payoutRoutingEnabled: env.FIAT_REPUBLIC_PAYOUT_ROUTING_ENABLED === 'true',
  };
}
