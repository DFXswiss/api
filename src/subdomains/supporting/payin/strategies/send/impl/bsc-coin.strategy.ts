import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInBscService } from '../../../services/payin-bsc.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class BscCoinStrategy extends EvmCoinStrategy {
  protected readonly logger: DfxLogger;

  constructor(readonly loggerFactory: LoggerFactory, bscService: PayInBscService, payInRepo: PayInRepository) {
    super(bscService, payInRepo);

    this.logger = this.loggerFactory.create(BscCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.BINANCE_SMART_CHAIN;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.bsc.bscWalletAddress, Blockchain.BINANCE_SMART_CHAIN);
  }
}
