import { Injectable } from '@nestjs/common';
import { ZanoTransferDto } from 'src/integration/blockchain/zano/dto/zano.dto';
import { ZanoService } from 'src/integration/blockchain/zano/services/zano.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { Deposit } from '../../address-pool/deposit/deposit.entity';
import { CryptoInput } from '../entities/crypto-input.entity';
import { PayInBitcoinBasedService } from './base/payin-bitcoin-based.service';

@Injectable()
export class PayInZanoService extends PayInBitcoinBasedService {
  constructor(private readonly zanoService: ZanoService) {
    super();
  }

  async getDeposit(index: number): Promise<Deposit> {
    return this.zanoService.getDeposit(index);
  }

  async checkHealthOrThrow(): Promise<void> {
    const isHealthy = await this.zanoService.isHealthy();
    if (!isHealthy) throw new Error('Zano node is unhealthy');
  }

  async getBlockHeight(): Promise<number> {
    return this.zanoService.getBlockHeight();
  }

  async checkTransactionCompletion(txId: string, minConfirmations: number): Promise<boolean> {
    return this.zanoService.isTxComplete(txId, minConfirmations);
  }

  async getTransactionHistory(startBlockHeight: number): Promise<ZanoTransferDto[]> {
    return this.zanoService.getTransactionHistory(startBlockHeight);
  }

  async sendTransfer(payIn: CryptoInput): Promise<{ outTxId: string; feeAmount: number }> {
    const asset = payIn.asset;

    const sendResult =
      asset.type === AssetType.COIN
        ? await this.zanoService.sendCoin(payIn.destinationAddress.address, payIn.sendingAmount)
        : await this.zanoService.sendToken(payIn.destinationAddress.address, payIn.sendingAmount, asset);

    return { outTxId: sendResult.txId, feeAmount: sendResult.fee };
  }
}
