import { Network as TatumNetwork, TatumSDK, Solana as TatumSolana } from '@tatumio/tatum';
import { GetConfig } from 'src/config/config';

export const TatumProvider = {
  provide: 'TATUM_SOLANA',
  useFactory: async () => {
    return TatumSDK.init<TatumSolana>({
      network: TatumNetwork.SOLANA,
      apiKey: GetConfig().blockchain.solana.solanaApiKey,
    });
  },
};
