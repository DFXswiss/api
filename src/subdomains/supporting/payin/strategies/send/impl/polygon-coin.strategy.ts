import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInPolygonService } from '../../../services/payin-polygon.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class PolygonCoinStrategy extends EvmCoinStrategy {
  constructor(polygonService: PayInPolygonService, payInRepo: PayInRepository, evmRegistryService: EvmRegistryService) {
    super(polygonService, payInRepo, evmRegistryService);
  }

  get blockchain(): Blockchain {
    return Blockchain.POLYGON;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.polygon.polygonWalletAddress, Blockchain.POLYGON);
  }
}
