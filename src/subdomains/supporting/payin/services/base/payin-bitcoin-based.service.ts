import { CryptoInput } from '../../entities/crypto-input.entity';

export abstract class PayInBitcoinBasedService {
  abstract checkHealthOrThrow();
  abstract getBlockHeight(): Promise<number>;
  abstract sendTransfer(input: CryptoInput): Promise<{ outTxId: string; feeAmount: number }>;
}
