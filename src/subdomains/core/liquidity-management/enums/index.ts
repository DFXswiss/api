import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { BankName } from 'src/subdomains/supporting/bank/bank/bank.entity';

export type LiquidityManagementType = Blockchain | BankName | ExchangeName;

export enum LiquidityManagementSystem {
  CAKE = 'Cake',
  KRAKEN = 'Kraken',
  BINANCE = 'Binance',
  DFX_DEX = 'DfxDex',
  ARBITRUM_L2_BRIDGE = 'ArbitrumL2Bridge',
  OPTIMISM_L2_BRIDGE = 'OptimismL2Bridge',
  POLYGON_L2_BRIDGE = 'PolygonL2Bridge',
  BASE_L2_BRIDGE = 'BaseL2Bridge',
  LIQUIDITY_PIPELINE = 'LiquidityPipeline',
}

export enum LiquidityManagementRuleStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
  PAUSED = 'Paused',
  PROCESSING = 'Processing',
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
