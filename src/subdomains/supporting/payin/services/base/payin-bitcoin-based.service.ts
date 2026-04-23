import { CryptoInput } from '../../entities/crypto-input.entity';

export interface UnconfirmedPayInFilterResult {
  nextBlockCandidates: CryptoInput[];
  failedPayIns: CryptoInput[];
}

export abstract class PayInBitcoinBasedService {
  abstract checkHealthOrThrow();
  abstract getBlockHeight(): Promise<number>;
  abstract sendTransfer(input: CryptoInput): Promise<{ outTxId: string; feeAmount: number }>;

  // Default: no unconfirmed forward filtering (chains without forwarding return empty)
  async filterUnconfirmedPayInsForForward(_payIns: CryptoInput[]): Promise<UnconfirmedPayInFilterResult> {
    return { nextBlockCandidates: [], failedPayIns: [] };
  }

  isAvailable(): boolean {
    return true;
  }
}
