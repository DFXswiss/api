import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInFiroService } from '../../../services/payin-firo.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class FiroStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(FiroStrategy);

  constructor(
    protected readonly firoService: PayInFiroService,
    protected payInRepo: PayInRepository,
  ) {
    super(firoService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.FIRO;
  }

  get assetType(): AssetType {
    return undefined;
  }

  get forwardRequired(): boolean {
    return true;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.firo.walletAddress, Blockchain.FIRO);
  }

  async checkTransactionCompletion(txId: string, minConfirmations: number): Promise<boolean> {
    return this.firoService.checkTransactionCompletion(txId, minConfirmations);
  }
}
