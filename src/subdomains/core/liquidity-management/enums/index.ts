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
  DFX_DEX = 'DfxDex',
  EVM_L2_BRIDGE = 'EvmL2Bridge',
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
