import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { In, IsNull, Not } from 'typeorm';
import { BlockchainRegistryService } from '../services/blockchain-registry.service';

@Injectable()
export class EvmDecimalsService {
  private readonly logger: DfxLogger;

  constructor(
    private readonly repoFactory: RepositoryFactory,
    private readonly blockchainRegistry: BlockchainRegistryService,
    readonly loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(EvmDecimalsService);
  }

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.ASSET_DECIMALS, timeout: 1800 })
  async setDecimals() {
    const assets = await this.repoFactory.asset.findBy({
      chainId: Not(IsNull()),
      blockchain: In(CryptoService.EthereumBasedChains),
      decimals: IsNull(),
      type: In([AssetType.COIN, AssetType.TOKEN]),
    });

    for (const asset of assets) {
      try {
        const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
        const currency = await client.getToken(asset);
        await this.repoFactory.asset.update(asset.id, { decimals: currency.decimals });
      } catch (e) {
        this.logger.error(`Failed to update decimals of asset ${asset.id}:`, e);
      }
    }
  }
}
