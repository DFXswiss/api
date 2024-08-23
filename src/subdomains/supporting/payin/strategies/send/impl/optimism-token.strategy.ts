import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';

@Injectable()
export class OptimismTokenStrategy extends EvmTokenStrategy {
  constructor(optimismService: PayInOptimismService, payInRepo: PayInRepository, evmRegistryService: EvmRegistryService) {
    super(optimismService, payInRepo, evmRegistryService);
  }

  get blockchain(): Blockchain {
    return Blockchain.OPTIMISM;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.optimism.optimismWalletAddress, Blockchain.OPTIMISM);
  }
}
