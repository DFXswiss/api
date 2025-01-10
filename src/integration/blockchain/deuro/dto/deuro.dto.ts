export interface DEuroPositionGraphDto {
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

export interface DEuroDepsGraphDto {
  id: string;
  profits: string;
  loss: string;
  reserve: string;
}

export interface DEuroLogDto {
  positionV2s: DEuroPositionDto[];
  poolShares: DEuroPoolSharesDto;
  totalSupply: number;
  totalValueLocked: number;
}

export interface DEuroInfoDto {
  totalSupplyDeuro: number;
  totalValueLockedInEur: number;
  depsMarketCapInEur: number;
}

export interface DEuroPositionDto {
  address: {
    position: string;
    deuro: string;
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

export interface DEuroPoolSharesDto {
  depsPrice: number;
  supply: number;
  marketCap: number;
  totalReserve: number;
  equityCapital: number;
  minterReserve: number;
  totalIncome: number;
  totalLosses: number;
}
