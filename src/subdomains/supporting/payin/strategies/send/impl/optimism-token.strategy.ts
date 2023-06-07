import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class OptimismTokenStrategy extends EvmTokenStrategy {
  blockchain = Blockchain.OPTIMISM;
  assetType = AssetType.TOKEN;

  constructor(optimismService: PayInOptimismService, payInRepo: PayInRepository) {
    super(optimismService, payInRepo);
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.optimism.optimismWalletAddress, Blockchain.OPTIMISM);
  }
}
