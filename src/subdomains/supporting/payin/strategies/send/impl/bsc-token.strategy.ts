import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { DfxLoggerService } from 'src/shared/services/dfx-logger.service';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmTokenStrategy } from './base/evm.token.strategy';

@Injectable()
export class BscTokenStrategy extends EvmTokenStrategy {
  protected readonly logger: DfxLoggerService;

  constructor(private readonly dfxLogger: DfxLoggerService, bscService: PayInBscService, payInRepo: PayInRepository) {
    super(bscService, payInRepo);

    this.logger = this.dfxLogger.create(BscTokenStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.BINANCE_SMART_CHAIN;
  }

  get assetType(): AssetType {
    return AssetType.TOKEN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.bsc.bscWalletAddress, Blockchain.BINANCE_SMART_CHAIN);
  }
}
