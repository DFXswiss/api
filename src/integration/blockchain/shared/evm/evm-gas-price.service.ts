import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { Blockchain } from '../enums/blockchain.enum';
import { BlockchainRegistryService } from '../services/blockchain-registry.service';

interface EvmGasPriceCacheData {
  timestamp: Date;
  gasPrice: number;
}

@Injectable()
export class EvmGasPriceService implements OnModuleInit {
  private readonly logger = new DfxLogger(EvmGasPriceService);

  private static readonly MINUTES_5 = 5 * 60;

  private static readonly GAS_PRICE_BLOCKCHAINS: Blockchain[] = [
    Blockchain.ETHEREUM,
    Blockchain.ARBITRUM,
    Blockchain.OPTIMISM,
    Blockchain.BASE,
    Blockchain.POLYGON,
  ];

  private gasPriceCache: Map<Blockchain, EvmGasPriceCacheData>;

  constructor(private readonly blockchainRegistryService: BlockchainRegistryService) {
    this.gasPriceCache = new Map();
  }

  async onModuleInit() {
    await this.updateGasPrice();
  }

  // --- JOBS --- //

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.UPDATE_GAS_PRICE })
  async processGasPrice(): Promise<void> {
    await this.updateGasPrice();
  }

  private async updateGasPrice() {
    for (const blockchain of EvmGasPriceService.GAS_PRICE_BLOCKCHAINS) {
      try {
        const client = this.blockchainRegistryService.getEvmClient(blockchain);
        this.gasPriceCache.set(blockchain, {
          timestamp: new Date(),
          gasPrice: +(await client.getRecommendedGasPrice()),
        });
      } catch (e) {
        this.gasPriceCache.delete(blockchain);
        this.logger.error(`Failed to get gas price of blockchain ${blockchain}:`, e);
      }
    }
  }

  getGasPrice(blockchain: Blockchain): number | undefined {
    const cacheData = this.gasPriceCache.get(blockchain);
    if (!cacheData) return;

    if (Util.secondsDiff(cacheData.timestamp) > EvmGasPriceService.MINUTES_5) return;

    return cacheData.gasPrice;
  }
}
