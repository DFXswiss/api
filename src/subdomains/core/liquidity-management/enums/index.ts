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
];
