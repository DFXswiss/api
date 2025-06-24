import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInPolygonService } from '../../../services/payin-polygon.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class PolygonTokenStrategy extends EvmTokenStrategy {
  protected readonly logger: DfxLoggerService;

  constructor(
    private readonly dfxLogger: DfxLoggerService,
    polygonService: PayInPolygonService,
    payInRepo: PayInRepository,
  ) {
    super(polygonService, payInRepo);

    this.logger = this.dfxLogger.create(PolygonTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.POLYGON;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.polygon.polygonWalletAddress, Blockchain.POLYGON);
  }
}
