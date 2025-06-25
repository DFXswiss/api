import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInGnosisService } from '../../../services/payin-gnosis.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class GnosisTokenStrategy extends EvmTokenStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, gnosisService: PayInGnosisService, payInRepo: PayInRepository) {
    super(gnosisService, payInRepo);

    this.logger = this.loggerFactory.create(GnosisTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.GNOSIS;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.gnosis.gnosisWalletAddress, Blockchain.GNOSIS);
  }
}
