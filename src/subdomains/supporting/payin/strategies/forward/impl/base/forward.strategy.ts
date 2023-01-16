import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';

export abstract class ForwardStrategy {
  abstract doForward(payIns: CryptoInput[]): Promise<void>;
}
