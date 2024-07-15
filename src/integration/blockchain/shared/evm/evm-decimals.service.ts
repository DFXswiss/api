import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EvmRegistryService } from 'src/integration/blockchain/shared/evm/evm-registry.service';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { RepositoryFactory } from 'src/shared/repositories/repository.factory';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { In, IsNull, Not } from 'typeorm';

@Injectable()
export class EvmDecimalsService {
  private readonly logger = new DfxLogger(EvmDecimalsService);

  constructor(private readonly repoFactory: RepositoryFactory, private readonly evmRegistry: EvmRegistryService) {}

  // --- JOBS --- //

  @Cron(CronExpression.EVERY_HOUR)
  @Lock(1800)
  async setDecimals() {
    if (DisabledProcess(Process.ASSET_DECIMALS)) return;

    const assets = await this.repoFactory.asset.findBy({
      chainId: Not(IsNull()),
      blockchain: In(CryptoService.EthereumBasedChains),
      decimals: IsNull(),
    });

    for (const asset of assets) {
      try {
        const client = this.evmRegistry.getClient(asset.blockchain);
        const currency = await client.getToken(asset);
        await this.repoFactory.asset.update(asset.id, { decimals: currency.decimals });
      } catch (e) {
        this.logger.error(`Failed to update decimals of asset ${asset.id}:`, e);
      }
    }
  }
}
