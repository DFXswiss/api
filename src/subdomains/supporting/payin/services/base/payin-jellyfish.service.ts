import { InWalletTransaction } from '@defichain/jellyfish-api-core/dist/category/wallet';

export abstract class PayInJellyfishService {
  abstract checkHealthOrThrow(): Promise<void>;
  abstract getTx(outTxId: string): Promise<InWalletTransaction>;
}
