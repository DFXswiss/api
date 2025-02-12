import { FrankencoinBasedCollateralDto } from '../../shared/frankencoin/frankencoin-based.dto';

export interface FrankencoinPositionGraphDto extends FrankencoinBasedCollateralDto {
  id: string;
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
  id: string;
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
  id: string;
  profits: string;
  loss: string;
  reserve: string;
}

export interface FrankencoinMinterGraphDto {
  id: string;
  minter: string;
  applicationPeriod: string;
  applicationFee: string;
  applyMessage: string;
  applyDate: string;
  suggestor: string;
  denyMessage: string;
  denyDate: string;
  vetor: string;
}

export interface FrankencoinDelegationGraphDto {
  id: string;
  owner: string;
  delegatedTo: string;
  pureDelegatedFrom: [string];
}

export interface FrankencoinTradeGraphDto {
  id: string;
  trader: string;
  amount: string;
  shares: string;
  price: string;
  time: string;
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
