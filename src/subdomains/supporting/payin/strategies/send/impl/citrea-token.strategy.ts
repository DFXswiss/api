import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInCitreaService } from '../../../services/payin-citrea.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class CitreaTokenStrategy extends EvmTokenStrategy {
  constructor(citreaService: PayInCitreaService, payInRepo: PayInRepository) {
    super(citreaService, payInRepo);
  }

  get blockchain(): Blockchain {
    return Blockchain.CITREA;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.citrea.citreaWalletAddress, Blockchain.CITREA);
  }
}
