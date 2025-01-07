export interface EurocoinPositionGraphDto {
  id: string;
  position: string;
  owner: string;
  deuro: string;
  collateral: string;
  price: string;
  collateralSymbol: string;
  collateralBalance: string;
  collateralDecimals: number;
  limitForClones: string;
  availableForClones: string;
  minted: string;
  reserveContribution: number;
  expiration: string;
}

export interface EurocoinDepsGraphDto {
  id: string;
  profits: string;
  loss: string;
  reserve: string;
}

export interface EurocoinLogDto {
  positionV2s: EurocoinPositionDto[];
  poolShares: EurocoinPoolSharesDto;
  totalSupply: number;
  totalValueLocked: number;
}

export interface EurocoinInfoDto {
  totalSupplyZchf: number;
  totalValueLockedInChf: number;
  depsMarketCapInChf: number;
}

export interface EurocoinSwapDto {
  xchfSwapLimit: number;
  zchfSwapLimit: number;
}

export interface EurocoinPositionDto {
  address: {
    position: string;
    eurocoin: string;
    collateral: string;
    owner: string;
  };
  collateral: {
    symbol: string;
    amount: number;
  };
  details: {
    availableAmount: number;
    totalBorrowed: number;
    liquidationPrice: number;
    retainedReserve: number;
    limit: number;
    expirationDate: Date;
  };
}

export interface EurocoinPoolSharesDto {
  depsPrice: number;
  supply: number;
  marketCap: number;
  totalReserve: number;
  equityCapital: number;
  minterReserve: number;
  totalIncome: number;
  totalLosses: number;
}
