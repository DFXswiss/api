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
    vbanBaseUrl: env.FRICK_VBAN_BASE_URL,
  };
}
