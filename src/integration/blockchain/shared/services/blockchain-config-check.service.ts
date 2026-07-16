import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config, Environment } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Blockchain } from '../enums/blockchain.enum';
import { BlockchainRegistryService } from './blockchain-registry.service';

@Injectable()
export class BlockchainConfigCheckService {
  private readonly logger = new DfxLogger(BlockchainConfigCheckService);

  constructor(private readonly registryService: BlockchainRegistryService) {}

  // periodic (not boot-only) signal, so the unconfigured-client alert stays active until the config is restored;
  // prd only, elsewhere unconfigured clients are the intended state
  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.BLOCKCHAIN_CONFIG_CHECK })
  logUnconfiguredClients(): void {
    if (Config.environment !== Environment.PRD) return;

    const unconfigured = Object.values(Blockchain).filter((chain) => {
      try {
        return !this.registryService.getClient(chain).isConfigured;
      } catch {
        return false;
      }
    });

    if (unconfigured.length) this.logger.warn(`Blockchain clients not configured: ${unconfigured.join(', ')}`);
  }
}
