import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { CardBankName, IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';

export type LiquidityManagementContext = Blockchain | ExchangeName | IbanBankName | CardBankName | 'Custom';

export enum LiquidityManagementSystem {
  CAKE = 'Cake',
  KRAKEN = 'Kraken',
  BINANCE = 'Binance',
  MEXC = 'MEXC',
  SCRYPT = 'Scrypt',
  DFX_DEX = 'DfxDex',
  ARBITRUM_L2_BRIDGE = 'ArbitrumL2Bridge',
  OPTIMISM_L2_BRIDGE = 'OptimismL2Bridge',
  POLYGON_L2_BRIDGE = 'PolygonL2Bridge',
  BASE_L2_BRIDGE = 'BaseL2Bridge',
  LAYERZERO_BRIDGE = 'LayerZeroBridge',
  CLEMENTINE_BRIDGE = 'ClementineBridge',
  BOLTZ = 'Boltz',
  LIQUIDITY_PIPELINE = 'LiquidityPipeline',
  FRANKENCOIN = 'Frankencoin',
  DEURO = 'dEURO',
  JUICE = 'Juice',
  XT = 'XT',
}

export enum LiquidityManagementRuleStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
  PAUSED = 'Paused',
  PROCESSING = 'Processing',
  DISABLED = 'Disabled',
}

export enum LiquidityManagementOrderStatus {
  CREATED = 'Created',
  IN_PROGRESS = 'InProgress',
  COMPLETE = 'Complete',
  NOT_PROCESSABLE = 'NotProcessable',
  FAILED = 'Failed',
  // Quarantine for an order whose request left our side without an observed outcome. Terminal for the
  // pipeline (it never resumes on its own) but not for the order: `resolveUncertainOrders` asks the venue
  // what happened and moves it on to IN_PROGRESS or FAILED. See OrderOutcomeUnknownException.
  //
  // Only where an integration can actually ask the venue does it stop waiting for a person: an order whose
  // lookup comes back with no record has its references cancelled once it has outlived the window in which
  // its request could still be in flight (ABANDON_UNCERTAIN_MINUTES, which differs for venue-internal trades
  // and transfers).
  //
  // Giving up is never concluded from the clock alone: past the bound the venue is asked to cancel every
  // reference the order claimed — sent or merely reserved — and only its answer that none can still execute
  // permits FAILED.
  // A venue that will not settle them, and an adapter that cannot cancel at all, keep waiting — for
  // `resolveUncertainOrderManually`.
  UNCERTAIN = 'Uncertain',
}

/** Outcome of asking a venue what happened to an order that ended in {@link LiquidityManagementOrderStatus.UNCERTAIN}. */
export enum UncertainOrderResolution {
  /** The venue knows the order — it was sent. Hand it back to the normal completion check. */
  SENT = 'Sent',
  /** The venue demonstrably does not know the order — nothing was executed, the rule may plan anew. */
  NOT_SENT = 'NotSent',
  /**
   * The venue answered, and the answer settles nothing. Stay in quarantine and look again later — until the
   * order outlives the abandon bound for its kind of request, at which point the caller tries to cancel
   * everything it sent. Only that confirmation releases it; the bound alone never does.
   */
  UNRESOLVED = 'Unresolved',
  /**
   * The venue could not be asked, or could not be asked completely.
   *
   * Deliberately not the same as UNRESOLVED: that one is an answer, this one is the absence of one, and a
   * caller that retires an order's outstanding work on the strength of a completed lookup must not retire it
   * on a failed one.
   *
   * "Not completely" covers an order with no reference to ask about at all: there is nothing to look up, so
   * nothing was learned.
   */
  UNAVAILABLE = 'Unavailable',
}

export enum LiquidityManagementPipelineStatus {
  CREATED = 'Created',
  IN_PROGRESS = 'InProgress',
  COMPLETE = 'Complete',
  STOPPED = 'Stopped',
  FAILED = 'Failed',
}

export enum LiquidityOptimizationType {
  DEFICIT = 'Deficit',
  REDUNDANCY = 'Redundancy',
}

export const LiquidityManagementExchanges = [
  LiquidityManagementSystem.KRAKEN,
  LiquidityManagementSystem.BINANCE,
  LiquidityManagementSystem.MEXC,
  LiquidityManagementSystem.XT,
  LiquidityManagementSystem.SCRYPT,
  LiquidityManagementSystem.FRANKENCOIN,
  LiquidityManagementSystem.DEURO,
  LiquidityManagementSystem.JUICE,
];
export const LiquidityManagementBridges = [
  LiquidityManagementSystem.BASE_L2_BRIDGE,
  LiquidityManagementSystem.POLYGON_L2_BRIDGE,
  LiquidityManagementSystem.ARBITRUM_L2_BRIDGE,
  LiquidityManagementSystem.OPTIMISM_L2_BRIDGE,
  LiquidityManagementSystem.LAYERZERO_BRIDGE,
  LiquidityManagementSystem.CLEMENTINE_BRIDGE,
  LiquidityManagementSystem.BOLTZ,
];
