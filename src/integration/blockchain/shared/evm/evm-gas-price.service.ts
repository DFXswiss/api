import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BigNumber, ethers } from 'ethers';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { Blockchain } from '../enums/blockchain.enum';
import { EvmRegistryService } from './evm-registry.service';
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

  constructor(private readonly evmRegistryService: EvmRegistryService) {
    this.gasPriceCache = new Map();
  }

  async onModuleInit() {
    await this.updateGasPrice();
  }

  // --- JOBS --- //

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock()
  async processGasPrice(): Promise<void> {
    if (DisabledProcess(Process.UPDATE_GAS_PRICE)) return;

    await this.updateGasPrice();
  }

  private async updateGasPrice() {
    for (const blockchain of EvmGasPriceService.GAS_PRICE_BLOCKCHAINS) {
      try {
        this.gasPriceCache.set(blockchain, {
          timestamp: new Date(),
          gasPrice: this.convertGasPrice(await this.evmRegistryService.getClient(blockchain).getRecommendedGasPrice()),
        });
      } catch (e) {
        this.gasPriceCache.delete(blockchain);
        this.logger.error(`Failed to get gas price of blockchain ${blockchain}:`, e);
      }
    }
  }

  private convertGasPrice(amount: BigNumber): number {
    return parseFloat(ethers.utils.formatUnits(amount, 'wei'));
  }

  getGasPrice(blockchain: Blockchain): number | undefined {
    const cacheData = this.gasPriceCache.get(blockchain);
    if (!cacheData) return;

    if (Util.secondsDiff(cacheData.timestamp) > EvmGasPriceService.MINUTES_5) return;

    return cacheData.gasPrice;
  }
}
