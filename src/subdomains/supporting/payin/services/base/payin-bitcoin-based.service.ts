import { BlockchainService } from 'src/integration/blockchain/shared/util/blockchain.service';
import { CryptoInput } from '../../entities/crypto-input.entity';

export abstract class PayInBitcoinBasedService extends BlockchainService {
  abstract checkHealthOrThrow();
  abstract sendTransfer(input: CryptoInput): Promise<{ outTxId: string; feeAmount: number }>;
}
