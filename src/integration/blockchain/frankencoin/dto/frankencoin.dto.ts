import { FrankencoinBasedCollateralDto } from '../../shared/frankencoin/frankencoin-based.dto';

export interface FrankencoinPositionGraphDto extends FrankencoinBasedCollateralDto {
  position: string;
  owner: string;
  zchf: string;
  price: string;
  limitForClones: string;
  availableForClones: string;
  minted: string;
  reserveContribution: number;
  expiration: string;
  closed: boolean;
  denied: boolean;
}

export interface FrankencoinChallengeGraphDto {
  challenger: string;
  position: string;
  start: string;
  duration: string;
  size: string;
  filledSize: string;
  acquiredCollateral: string;
  number: string;
  bid: string;
  status: string;
}

export interface FrankencoinFpsGraphDto {
  profits: string;
  losses: string;
}

export interface FrankencoinLogDto {
  swap: FrankencoinSwapDto;
  positionV1s: FrankencoinPositionDto[];
  positionV2s: FrankencoinPositionDto[];
  poolShares: FrankencoinPoolSharesDto;
  totalSupply: number;
  totalValueLocked: number;
}

export interface FrankencoinInfoDto {
  totalSupplyZchf: number;
  totalValueLockedInChf: number;
  fpsMarketCapInChf: number;
}

export interface FrankencoinSwapDto {
  xchfSwapLimit: number;
  zchfSwapLimit: number;
}

export interface FrankencoinPositionDto {
  address: {
    position: string;
    frankencoin: string;
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

export interface FrankencoinPoolSharesDto {
  fpsPrice: number;
  supply: number;
  marketCap: number;
  totalReserve: number;
  equityCapital: number;
  minterReserve: number;
  totalIncome: number;
  totalLosses: number;
}
