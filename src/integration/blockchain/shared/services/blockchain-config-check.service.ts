import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config, Environment } from 'src/config/config';
import { BitcoinNodeType } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { TestBlockchains } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';

@Injectable()
export class BlockchainConfigCheckService {
  private readonly logger = new DfxLogger(BlockchainConfigCheckService);

  constructor(private readonly registryService: BlockchainRegistryService) {}

  // periodic (not boot-only) signal, so the unconfigured-client alert stays active until the config is restored;
  // prd only, elsewhere unconfigured clients are the intended state
  @DfxCron(CronExpression.EVERY_5_MINUTES, { process: Process.BLOCKCHAIN_CONFIG_CHECK })
  logUnconfiguredClients(): void {
    if (Config.environment !== Environment.PRD) return;

    const unconfigured = [...this.unconfiguredChains(), ...this.unconfiguredBitcoinNodes()];

    if (unconfigured.length) this.logger.warn(`Blockchain clients not configured: ${unconfigured.join(', ')}`);
  }

  // Bitcoin is swept per node type below; test blockchains are not configured on prd by design
  // (NODE_BTC_TESTNET4_OUT_URL_ACTIVE is set on dfxdev only) and would keep the alert firing permanently
  private unconfiguredChains(): string[] {
    return Object.values(Blockchain)
      .filter((c) => c !== Blockchain.BITCOIN && !TestBlockchains.includes(c))
      .filter((c) => {
        try {
          return !this.registryService.getClient(c)?.isConfigured;
        } catch (e) {
          // enum members without a blockchain service (Lightning, exchanges, banks, payment providers)
          if (e instanceof Error && e.message.startsWith('No service found for blockchain')) return false;
          throw e;
        }
      });
  }

  // getClient() only yields the input node, but a missing output node breaks every BTC payout
  private unconfiguredBitcoinNodes(): string[] {
    return Object.values(BitcoinNodeType)
      .filter((t) => !this.registryService.getBitcoinClient(Blockchain.BITCOIN, t)?.isConfigured)
      .map((t) => `${Blockchain.BITCOIN} (${t})`);
  }
}
