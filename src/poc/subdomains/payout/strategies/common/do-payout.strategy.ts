import { BuyCrypto } from 'src/payment/models/buy-crypto/entities/buy-crypto.entity';

export abstract class DoPayoutStrategy {
  abstract doPayout(tx: BuyCrypto): Promise<void>;
}
