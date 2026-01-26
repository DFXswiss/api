import { FrankencoinBasedCollateralDto } from '../../shared/frankencoin/frankencoin-based.dto';

export interface JuicePositionGraphDto extends FrankencoinBasedCollateralDto {
  id: string;
  position: string;
  owner: string;
  jusd: string;
  price: string;
  limitForClones: string;
  availableForClones: string;
  principal: string;
  reserveContribution: number;
  expiration: string;
  closed: boolean;
  denied: boolean;
}

export interface JuiceEquityGraphDto {
  id: string;
  profits: string;
  loss: string;
  reserve: string;
}

export interface JuiceLogDto {
  positionV2s: JuicePositionDto[];
  poolShares: JuicePoolSharesDto;
  savings: JuiceSavingsLogDto;
  bridges: JuiceBridgeLogDto[];
  totalSupply: number;
  totalValueLocked: number;
  totalBorrowed: number;
}

export interface JuiceInfoDto {
  totalSupplyJusd: number;
  totalValueLockedInUsd: number;
  juiceMarketCapInUsd: number;
}

export interface JuicePositionDto {
  address: {
    position: string;
    jusd: string;
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
    virtualPrice: number;
    retainedReserve: number;
    limit: number;
    expirationDate: Date;
  };
}

export interface JuicePoolSharesDto {
  juicePrice: number;
  supply: number;
  marketCap: number;
  totalReserve: number;
  equityCapital: number;
  minterReserve: number;
  totalIncome: number;
  totalLosses: number;
}

export interface JuiceSavingsInfoDto {
  totalSaved: number;
  totalWithdrawn: number;
  totalBalance: number;
  totalInterest: number;
  rate: number;
  ratioOfSupply: number;
}

export interface JuiceSavingsLogDto {
  totalSaved: number;
  totalBalance: number;
}

export interface JuiceBridgeLogDto {
  symbol: string;
  minted: number;
}
