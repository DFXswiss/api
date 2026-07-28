export interface FrickConfig {
  baseUrl: string;
  apiKey: string;
  privateKey: string;
  serverPublicKey: string;
  customer: string;
  payoutEnabled: boolean;
  approveWithoutTan: boolean;
  vbanBaseUrl: string;
}

export function buildFrickConfig(env: NodeJS.ProcessEnv): FrickConfig {
  return {
    baseUrl: env.FRICK_BASE_URL,
    apiKey: env.FRICK_API_KEY,
    privateKey: env.FRICK_PRIVATE_KEY?.split('<br>').join('\n'),
    serverPublicKey: env.FRICK_SERVER_PUBLIC_KEY?.split('<br>').join('\n'),
    customer: env.FRICK_CUSTOMER,
    payoutEnabled: env.FRICK_PAYOUT_ENABLED === 'true',
    approveWithoutTan: env.FRICK_APPROVE_WITHOUT_TAN === 'true',
    // Named FRICK_VBAN_API_URL (not FRICK_VBAN_BASE_URL) so older production code that
    // treats Bank Frick as a generic EUR vIBAN provider can never be activated by
    // setting this env alone before this PR is live or after a rollback.
    vbanBaseUrl: env.FRICK_VBAN_API_URL,
  };
}
