import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { UpdateResult } from 'src/shared/models/entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { BlockchainRegistryService } from '../services/blockchain-registry.service';
import { EvmBlockchains } from '../util/blockchain.util';

@Injectable()
export class EvmDecimalsService {
  private readonly logger = new DfxLogger(EvmDecimalsService);

  constructor(
    private readonly assetService: AssetService,
    private readonly blockchainRegistry: BlockchainRegistryService,
  ) {}

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_HOUR, { process: Process.ASSET_DECIMALS, timeout: 1800 })
  async setDecimals() {
    const assets = await this.assetService.getEvmAssetsWithoutDecimals(EvmBlockchains);

    const updates: UpdateResult<Asset>[] = [];

    for (const asset of assets) {
      try {
        const client = this.blockchainRegistry.getEvmClient(asset.blockchain);
        const currency = await client.getToken(asset);
        updates.push([asset.id, { decimals: currency.decimals }]);
      } catch (e) {
        this.logger.error(`Failed to update decimals of asset ${asset.id}:`, e);
      }
    }

    // Nothing to write means nothing to invalidate: this job runs hourly and usually finds no asset,
    // so an unconditional call would drop the whole asset cache every hour for no reason.
    if (updates.length) await this.assetService.updateAssets(updates);
  }
}
