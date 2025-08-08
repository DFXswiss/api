import { Injectable } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ZanoTransferDto } from 'src/integration/blockchain/zano/dto/zano.dto';
import { ZanoService } from 'src/integration/blockchain/zano/services/zano.service';
import { Deposit } from '../../address-pool/deposit/deposit.entity';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInBitcoinBasedService } from './base/payin-bitcoin-based.service';

@Injectable()
export class PayInZanoService extends PayInBitcoinBasedService {
  constructor(private readonly zanoService: ZanoService) {
    super();
  }

  async getDepositByBlockchainAndIndex(blockchain: Blockchain, index: number): Promise<Deposit> {
    return this.zanoService.getDepositByBlockchainAndIndex(blockchain, index);
  }

  async checkHealthOrThrow(): Promise<void> {
    const isHealthy = await this.zanoService.isHealthy();
    if (!isHealthy) throw new Error('Zano node is unhealthy');
  }

  async checkTransactionCompletion(txId: string, minConfirmations: number): Promise<boolean> {
    return this.zanoService.isTxComplete(txId, minConfirmations);
  }

  async getTransactionHistory(startBlockHeight: number): Promise<ZanoTransferDto[]> {
    return this.zanoService.getTransactionHistory(startBlockHeight);
  }

  async sendTransfer(payIn: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    return this.zanoService
      .sendTransfer(payIn.destinationAddress.address, payIn.sendingAmount)
      .then((r) => ({ outTxId: r.txId, feeAmount: r.fee }));
  }
}
