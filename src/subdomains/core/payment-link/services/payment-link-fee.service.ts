import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Environment, GetConfig } from 'src/config/config';
import { MIN_FEE_RATE_SAT_VB } from 'src/integration/blockchain/bitcoin/services/bitcoin-based-fee.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentLinkBlockchains } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { PayoutBitcoinService } from 'src/subdomains/supporting/payout/services/payout-bitcoin.service';
import { BlockchainRegistryService } from '../../../../integration/blockchain/shared/services/blockchain-registry.service';

interface FeeCacheData {
  timestamp: Date;
  fee: number;
}

@Injectable()
export class PaymentLinkFeeService implements OnModuleInit {
  private readonly logger = new DfxLogger(PaymentLinkFeeService);

  private static readonly MINUTES_5 = 5 * 60;

  private readonly feeCache: Map<Blockchain, FeeCacheData>;

  constructor(
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly payoutBitcoinService: PayoutBitcoinService,
  ) {
    this.feeCache = new Map();
  }

  onModuleInit() {
    void this.updateFees();
  }

  // --- JOBS --- //
  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.UPDATE_BLOCKCHAIN_FEE })
  async updateFees(): Promise<void> {
    if (GetConfig().environment === Environment.LOC) return;

    for (const blockchain of PaymentLinkBlockchains) {
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
      case Blockchain.KUCOIN_PAY:
      case Blockchain.LIGHTNING:
      case Blockchain.MONERO:
      case Blockchain.ZANO:
      case Blockchain.SOLANA:
      case Blockchain.TRON:
      case Blockchain.CARDANO:
      case Blockchain.INTERNET_COMPUTER:
        return 0;

      case Blockchain.ETHEREUM:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.BASE:
      case Blockchain.GNOSIS:
      case Blockchain.POLYGON:
      case Blockchain.BINANCE_SMART_CHAIN: {
        const client = this.blockchainRegistryService.getEvmClient(blockchain);
        return +(await client.getRecommendedGasPrice());
      }

      // The customer minimum is the network's own minimum for an inbound payment to confirm — it
      // must NOT include the CPFP/default margin from getSendFeeRate, which exists only for DFX's
      // own outbound spends. The value differs per chain because the chains do, but neither carries
      // the payout margin.
      case Blockchain.BITCOIN:
        // Bitcoin fees are user-adjustable and the chain can congest, so use the recommended
        // (next-block) rate, which adapts to congestion — floored at the relay minimum so the
        // advertised minimum is always relayable.
        return Math.max(await this.payoutBitcoinService.getRecommendedFeeRate(), MIN_FEE_RATE_SAT_VB);

      case Blockchain.FIRO:
        // Firo/Spark transactions carry a protocol-fixed fee (Firo's GetMinimumFee, floored at
        // minRelayTxFee) the user cannot raise, so a valid Spark payment pays exactly the network
        // relay floor, and Firo does not congest. Use the relay floor itself (below even the
        // recommended rate; configurable via FIRO_MIN_FEE_RATE) — anything above it rejects Spark.
        return GetConfig().blockchain.firo.minFeeRate;
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
