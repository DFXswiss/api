import { CryptoInput } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';

export abstract class ReturnStrategy {
  abstract doReturn(payIns: CryptoInput[]): Promise<void>;
}
