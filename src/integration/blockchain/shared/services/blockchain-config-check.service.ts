import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config, Environment } from 'src/config/config';
import { BitcoinNodeType } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { TestBlockchains } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';

@Injectable()
export class BlockchainConfigCheckService {
  private readonly logger = new DfxLogger(BlockchainConfigCheckService);

  constructor(private readonly blockchainRegistryService: BlockchainRegistryService) {}

  // periodic (not boot-only) signal, so the unconfigured-client alert stays active until the config is restored;
  // prd only, elsewhere unconfigured clients are the intended state.
  // reports what a client can actually tell us today: a missing Tatum API key (Cardano, Solana, Tron) and a
  // missing node URL (Bitcoin, Firo). Clients that build unconditionally report configured, so silence here
  // is not a full-coverage statement
  @DfxCron(CronExpression.EVERY_5_MINUTES, { scope: CronScope.WORKER, process: Process.BLOCKCHAIN_CONFIG_CHECK })
  logUnconfiguredClients(): void {
    if (Config.environment !== Environment.PRD) return;

    const unconfigured = [...this.getUnconfiguredChains(), ...this.getUnconfiguredBitcoinNodes()];

    // singular, to match the deployed alert rule as well as the boot-time warns of the sibling services
    if (unconfigured.length) this.logger.warn(`Blockchain client not configured: ${unconfigured.join(', ')}`);
  }

  // Bitcoin is swept per node type below; test blockchains are not configured on prd by design
  // (NODE_BTC_TESTNET4_OUT_URL_ACTIVE is set on dfxdev only) and would keep the alert firing permanently
  private getUnconfiguredChains(): Blockchain[] {
    return Object.values(Blockchain)
      .filter((c) => c !== Blockchain.BITCOIN && !TestBlockchains.includes(c))
      .filter((c) => {
        try {
          return !this.blockchainRegistryService.getClient(c)?.isConfigured;
        } catch (e) {
          // enum members without a blockchain service (Lightning, exchanges, banks, payment providers)
          if (e instanceof Error && e.message.startsWith('No service found for blockchain')) return false;

          // report instead of aborting the sweep: an unchecked chain must not let the alert resolve
          this.logger.error(`Failed to check the ${c} client configuration:`, e);
          return true;
        }
      });
  }

  // getClient() only yields the input node, but a missing output node breaks every BTC payout
  private getUnconfiguredBitcoinNodes(): string[] {
    return Object.values(BitcoinNodeType)
      .filter((t) => !this.blockchainRegistryService.getBitcoinClient(Blockchain.BITCOIN, t)?.isConfigured)
      .map((t) => `${Blockchain.BITCOIN} (${t})`);
  }
}
