import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBaseService } from '../../../services/payin-base.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';

@Injectable()
export class BaseCoinStrategy extends EvmCoinStrategy {
  protected readonly logger: DfxLoggerService;
  
  constructor(private readonly dfxLogger: DfxLoggerService,baseService: PayInBaseService, payInRepo: PayInRepository) {
    super(baseService, payInRepo);

    this.logger = this.dfxLogger.create(BaseCoinStrategy);
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
