export enum LiquidityManagementContext {
  DEFICHAIN = 'DeFiChain',
  ETHEREUM = 'Ethereum',
  BSC = 'Bsc',
  BITCOIN = 'Bitcoin',
  BANK = 'Bank',
}

export enum LiquidityManagementSystem {
  CAKE = 'Cake',
  KRAKEN = 'Kraken',
  BINANCE = 'Binance',
}

export enum LiquidityManagementRuleStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
  PROCESSING = 'Processing',
}

export enum LiquidityManagementOrderStatus {
  CREATED = 'Created',
  IN_PROGRESS = 'InProgress',
  COMPLETE = 'Complete',
  FAILED = 'Failed',
}

export enum LiquidityManagementPipelineStatus {
  CREATED = 'Created',
  IN_PROGRESS = 'InProgress',
  COMPLETE = 'Complete',
  FAILED = 'Failed',
}

export enum LiquidityOptimizationType {
  DEFICIT = 'Deficit',
  REDUNDANCY = 'Redundancy',
}
