export enum LiquidityManagementContext {
  DEFICHAIN = 'DeFiChain',
  ETHEREUM = 'Ethereum',
  BSC = 'Bsc',
  BITCOIN = 'Bitcoin',
  ARBITRUM = 'Arbitrum',
  OPTIMISM = 'Optimism',
  BANK = 'Bank',
}

export enum LiquidityManagementSystem {
  CAKE = 'Cake',
  KRAKEN = 'Kraken',
  BINANCE = 'Binance',
  DFX_DEX = 'DfxDex',
  ARBITRUM_L2_BRIDGE = 'ArbitrumL2Bridge',
  OPTIMISM_L2_BRIDGE = 'OptimismL2Bridge',
  POLYGON_L2_BRIDGE = 'PolygonL2Bridge',
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
