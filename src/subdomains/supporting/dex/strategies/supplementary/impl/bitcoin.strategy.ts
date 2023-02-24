import { Injectable } from '@nestjs/common';
import { TransferRequest, TransactionQuery, TransactionResult } from '../../../interfaces';
import { DexBitcoinService } from '../../../services/dex-bitcoin.service';
import { SupplementaryStrategy } from './base/supplementary.strategy';

@Injectable()
export class BitcoinStrategy extends SupplementaryStrategy {
  constructor(private readonly dexBitcoinService: DexBitcoinService) {
    super();
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, amount } = request;

    return this.dexBitcoinService.sendUtxoToMany([{ addressTo: destinationAddress, amount }]);
  }

  async transferMinimalCoin(address: string): Promise<string> {
    return this.dexBitcoinService.transferMinimalUtxo(address);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexBitcoinService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(_query: TransactionQuery): Promise<TransactionResult> {
    throw new Error('Method not implemented');
  }
}
