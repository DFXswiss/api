export interface TronChainParameterDto {
  bandwidthUnitPrice: number;
  energyUnitPrice: number;
  createAccountFee: number;
  createAccountBandwidthFee: number;
}

export interface TronResourceDto {
  freeNetLimit: number;
  NetLimit: number;
  EnergyLimit: number;
}

export interface TronAddressResourcesDto {
  bandwidth: number;
  energy: number;
}

export interface TronTransactionResponse {
  ret: { contractRet: string; fee?: number }[];
  signature: string[];
  blockNumber: number;
  txID: string;
  netFee?: number;
  fee?: number;
  netUsage?: number;
  energyFee?: number;
  energyUsageTotal: number;
  rawData: TronTransactionRawDataResponse;
  expiration: number;
  fee_limit?: number;
}

export interface TronTransactionRawDataResponse {
  contract: TronTransactionContractResponse[];
  timestamp: number;
}

export interface TronTransactionContractResponse {
  parameter: {
    value: {
      ownerAddressBase58: string;
      amount?: number;
      toAddressBase58?: string;
      data?: string;
      contractAddressBase58?: string;
    };
  };
  type: string;
}

export interface TronTransactionDto {
  status: string;
  blockNumber: number;
  timestamp: number;
  txId: string;
  fee: number;
  from: string;
  to: string;
  amount: number;
  tokenAddress?: string;
}
