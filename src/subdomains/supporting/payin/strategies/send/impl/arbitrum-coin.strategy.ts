import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInArbitrumService } from '../../../services/payin-arbitrum.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class ArbitrumCoinStrategy extends EvmCoinStrategy {
  protected readonly logger: DfxLogger;

  constructor(
    readonly loggerFactory: LoggerFactory,
    arbitrumService: PayInArbitrumService,
    payInRepo: PayInRepository,
  ) {
    super(arbitrumService, payInRepo);

    this.logger = this.loggerFactory.create(ArbitrumCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.ARBITRUM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.arbitrum.arbitrumWalletAddress, Blockchain.ARBITRUM);
  }
}
