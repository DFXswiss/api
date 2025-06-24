import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBaseService } from '../../../services/payin-base.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class BaseTokenStrategy extends EvmTokenStrategy {
  protected readonly logger: DfxLoggerService;

  constructor(private readonly dfxLogger: DfxLoggerService, baseService: PayInBaseService, payInRepo: PayInRepository) {
    super(baseService, payInRepo);

    this.logger = this.dfxLogger.create(BaseTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.BASE;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.base.baseWalletAddress, Blockchain.BASE);
  }
}
