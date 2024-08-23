import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBaseService } from '../../../services/payin-base.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class BaseCoinStrategy extends EvmCoinStrategy {
  constructor(baseService: PayInBaseService, payInRepo: PayInRepository, evmRegistryService: EvmRegistryService) {
    super(baseService, payInRepo, evmRegistryService);
  }

  get blockchain(): Blockchain {
    return Blockchain.BASE;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.base.baseWalletAddress, Blockchain.BASE);
  }
}
