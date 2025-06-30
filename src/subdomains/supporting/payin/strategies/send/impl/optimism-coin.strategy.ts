import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { PayInRepository } from '../../../repositories/payin.repository';
import { PayInOptimismService } from '../../../services/payin-optimism.service';
import { EvmCoinStrategy } from './base/evm-coin.strategy';

@Injectable()
export class OptimismCoinStrategy extends EvmCoinStrategy {
  protected readonly logger: DfxLogger;

  constructor(
    readonly loggerFactory: LoggerFactory,
    optimismService: PayInOptimismService,
    payInRepo: PayInRepository,
  ) {
    super(optimismService, payInRepo);

    this.logger = this.loggerFactory.create(OptimismCoinStrategy);
  }

  get blockchain(): Blockchain {
    return Blockchain.OPTIMISM;
  }

  get assetType(): AssetType {
    return AssetType.COIN;
  }

  protected getForwardAddress(): BlockchainAddress {
    return BlockchainAddress.create(Config.blockchain.optimism.optimismWalletAddress, Blockchain.OPTIMISM);
  }
}
