import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { PayoutBitcoinService } from 'src/subdomains/supporting/payout/services/payout-bitcoin.service';
import { PayoutMoneroService } from 'src/subdomains/supporting/payout/services/payout-monero.service';
import { Blockchain, PaymentLinkBlockchain } from '../../../../integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from '../../../../integration/blockchain/shared/services/blockchain-registry.service';

interface FeeCacheData {
  timestamp: Date;
  fee: number;
}

@Injectable()
export class PaymentLinkFeeService implements OnModuleInit {
  private readonly logger = new DfxLogger(PaymentLinkFeeService);

  private static readonly MINUTES_5 = 5 * 60;

  private feeCache: Map<Blockchain, FeeCacheData>;

  constructor(
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly payoutMoneroService: PayoutMoneroService,
    private readonly payoutBitcoinService: PayoutBitcoinService,
  ) {
    this.feeCache = new Map();
  }

  async onModuleInit() {
    await this.updateFees();
  }

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.UPDATE_BLOCKCHAIN_FEE })
  async updateFees(): Promise<void> {
    for (const blockchain of Object.values(PaymentLinkBlockchain)) {
      try {
        const fee = await this.calculateFee(blockchain);
        this.feeCache.set(blockchain, {
          timestamp: new Date(),
          fee,
        });
      } catch (e) {
        this.feeCache.delete(blockchain);
        this.logger.error(`Failed to get fee for blockchain ${blockchain}:`, e);
      }
    }
  }

  private async calculateFee(blockchain: Blockchain): Promise<number> {
    switch (blockchain) {
      case Blockchain.BINANCE_PAY:
      case Blockchain.LIGHTNING:
        return 0;

      case Blockchain.ETHEREUM:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.BASE:
      case Blockchain.GNOSIS:
      case Blockchain.POLYGON:
        const client = this.blockchainRegistryService.getEvmClient(blockchain);
        return +(await client.getRecommendedGasPrice());

      case Blockchain.MONERO:
        return MoneroHelper.xmrToAu(await this.payoutMoneroService.getEstimatedFee());

      case Blockchain.BITCOIN:
        return this.payoutBitcoinService.getCurrentFeeRate();
    }
  }

  // --- PUBLIC METHODS --- //
  async getMinFee(blockchain: Blockchain): Promise<number | undefined> {
    const cacheData = this.feeCache.get(blockchain);
    if (!cacheData) return;

    if (Util.secondsDiff(cacheData.timestamp) > PaymentLinkFeeService.MINUTES_5) return;

    return cacheData.fee;
  }
}
