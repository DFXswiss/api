import { CryptoInput } from '../../entities/crypto-input.entity';

export interface UnconfirmedPayInFilterResult {
  nextBlockCandidates: CryptoInput[];
  failedPayIns: CryptoInput[];
}

export abstract class PayInBitcoinBasedService {
  abstract checkHealthOrThrow();
  abstract getBlockHeight(): Promise<number>;
  abstract sendTransfer(input: CryptoInput): Promise<{ outTxId: string; feeAmount: number }>;
}
