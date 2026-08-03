import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config, CronRole, Environment, GetConfig } from 'src/config/config';
import { MIN_FEE_RATE_SAT_VB } from 'src/integration/blockchain/bitcoin/services/bitcoin-based-fee.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PaymentLinkBlockchains } from 'src/integration/blockchain/shared/util/blockchain.util';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Process } from 'src/shared/services/process.service';
import { CronScope, DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { PayoutBitcoinService } from 'src/subdomains/supporting/payout/services/payout-bitcoin.service';
import { PayoutFiroService } from 'src/subdomains/supporting/payout/services/payout-firo.service';
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

  /**
   * The loads currently in flight, one entry per blockchain, so concurrent readers of a cold cache
   * share one fetch instead of each starting their own. Without it a burst of quotes for the same
   * chain would fire one gas-price call per request: the cache is only written when a load
   * RESOLVES, so every request arriving until then sees the same empty entry.
   *
   * That burst is not hypothetical here. `updateFees` is leased, so among several API processes
   * only one wins it per tick and the others rely on this path for a whole minute.
   */
  private readonly loading = new Map<Blockchain, Promise<number>>();

  constructor(
    private readonly blockchainRegistryService: BlockchainRegistryService,
    private readonly payoutBitcoinService: PayoutBitcoinService,
    private readonly payoutFiroService: PayoutFiroService,
  ) {
    this.feeCache = new Map();
  }

  /**
   * Warms the cache at boot — but only where something reads it.
   *
   * `onModuleInit` runs in EVERY process, whatever `CRON_ROLE` says: it is a Nest lifecycle hook,
   * not a cron job, so the scope on `updateFees` below does not reach it. Called unconditionally
   * it would undo that scope at boot and make the worker do the one thing the scope exists to
   * prevent — query gas prices for eight EVM chains plus Bitcoin and Firo to fill a map nothing
   * in that process ever reads.
   *
   * The condition is deliberately about serving requests rather than about which jobs this role
   * registers. This cache has exactly one reader, `getMinFee`, and every path to it is a request
   * path; a warm cache is worth something where those requests land and nowhere else. Stating it
   * that way also keeps the scope table in `runsInThisRole` the single place that maps roles to
   * scopes, instead of copying it here where a later change would not reach it.
   */
  onModuleInit() {
    if (Config.cronRole === CronRole.WORKER) return;

    void this.updateFees();
  }

  // --- JOBS --- //
  /**
   * Scope Api, not Both: the cache it fills is a field of this service, and the only reader is
   * getMinFee below. Following that chain out — createTransferAmount -> createTransferAmounts ->
   * createQuote / createPayRequest, plus the Binance webhook handler — every one of them is a
   * request path. This job is the only `Api`-scoped cron in the domain, and it is the writer, not
   * a reader. None of the Worker jobs in this domain reaches
   * the cache: PaymentCronService::forwardDeposits takes its fee rate from BitcoinFeeService, and
   * ::processExpiredPayments and ::checkTxConfirmations price nothing — they move a payment out of
   * `Pending` and cancel or close what hangs off it.
   *
   * Both would also break the rule this scope mechanism introduced: a job that runs in every
   * process must be harmless twice over, and this one queries gas prices for eight EVM chains
   * plus Bitcoin and Firo fee estimates on every tick. In the worker those calls would spend
   * quota to produce a value nothing there reads.
   */
  @DfxCron(CronExpression.EVERY_MINUTE, { scope: CronScope.API, process: Process.UPDATE_BLOCKCHAIN_FEE })
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
      case Blockchain.SEPOLIA:
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
        // Same principle as Bitcoin: Firo's own next-block rate without the payout margin, floored
        // at the relay minimum so it stays relayable. The current OCP deposit address is transparent,
        // so a Stack Wallet payment is a Spark-spend to it, whose fee sits at the relay floor and
        // cannot be raised; Firo does not congest and its node usually returns no estimate, so this
        // resolves to the relay floor in practice — exactly what that Spark-spend pays. A dedicated
        // relay-floor cap belongs here only once a Spark `sm1…` deposit address is deployed, whose
        // protocol-capped fee cannot follow a congestion-adaptive minimum.
        return Math.max(await this.payoutFiroService.getRecommendedFeeRate(), MIN_FEE_RATE_SAT_VB);
    }
  }

  // --- PUBLIC METHODS --- //
  /**
   * Loads on demand when the cache has nothing usable, rather than answering `undefined`.
   *
   * CONTRIBUTING: "A cache read in a request path must load on demand … A cron job may refresh
   * it, but must not be the only thing filling it." The job above refreshes; this is the load.
   *
   * Before the split that distinction did not bite: one process ran the refresh and served the
   * requests, so a filled cache and a reading request were the same process. Now the refresh is
   * `Api`-scoped AND leased, so among several API processes only one wins it per tick — the
   * others would serve `undefined` for a fee they could have fetched, and `createQuote` would
   * price without it.
   *
   * Only the blockchain that was asked for is loaded, not the whole set: a request pays for what
   * it needs, and the job stays the thing that keeps the rest warm.
   */
  async getMinFee(blockchain: Blockchain): Promise<number | undefined> {
    const cacheData = this.feeCache.get(blockchain);
    const usable = cacheData && Util.secondsDiff(cacheData.timestamp) <= PaymentLinkFeeService.MINUTES_5;
    if (usable) return cacheData.fee;

    // The same guard the job carries, for the same reason. On LOC there are no node connections to
    // ask, so `updateFees` never fills the cache and this path would run into the timeout of every
    // one of those calls on every request. Answering `undefined` is what a local environment
    // returned before this method loaded anything, and the callers already handle it.
    if (GetConfig().environment === Environment.LOC) return undefined;

    try {
      return await this.loadFee(blockchain);
    } catch (e) {
      // Same shape as the job's own failure handling: a fee source that cannot be reached leaves
      // the caller without a minimum, which is what it would have had anyway. Logged rather than
      // thrown, so one unreachable chain does not fail a quote for the others.
      this.logger.error(`Failed to load fee for blockchain ${blockchain} on demand:`, e);

      return undefined;
    }
  }

  // --- HELPER METHODS --- //
  /**
   * One load per blockchain at a time; concurrent callers await the one already running.
   *
   * The entry is removed in `finally`, before the promise is handed out. A failed load therefore
   * leaves nothing behind that a later call would await forever, and the next caller retries
   * rather than inheriting the failure — the cache is a fee that expires, not a decision.
   */
  private loadFee(blockchain: Blockchain): Promise<number> {
    const running = this.loading.get(blockchain);
    if (running) return running;

    const load = (async () => {
      try {
        const fee = await this.calculateFee(blockchain);
        this.feeCache.set(blockchain, { timestamp: new Date(), fee });

        return fee;
      } finally {
        this.loading.delete(blockchain);
      }
    })();

    this.loading.set(blockchain, load);

    return load;
  }
}
