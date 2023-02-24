import { Injectable } from '@nestjs/common';
import { TransactionQuery, TransactionResult, TransferRequest } from '../../../interfaces';
import { SupplementaryStrategy } from './base/supplementary.strategy';
import { DexDeFiChainService } from '../../../services/dex-defichain.service';

@Injectable()
export class DeFiChainStrategy extends SupplementaryStrategy {
  constructor(private readonly dexDeFiChainService: DexDeFiChainService) {
    super();
  }

  async transferLiquidity(request: TransferRequest): Promise<string> {
    const { destinationAddress, asset, amount } = request;

    return this.dexDeFiChainService.transferLiquidity(destinationAddress, asset.dexName, amount);
  }

  async transferMinimalCoin(address: string): Promise<string> {
    return this.dexDeFiChainService.transferMinimalUtxo(address);
  }

  async checkTransferCompletion(transferTxId: string): Promise<boolean> {
    return this.dexDeFiChainService.checkTransferCompletion(transferTxId);
  }

  async findTransaction(_query: TransactionQuery): Promise<TransactionResult> {
    throw new Error('Method not implemented');
  }
}
