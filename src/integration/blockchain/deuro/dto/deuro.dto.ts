import { FrankencoinBasedCollateralDto } from '../../shared/frankencoin/frankencoin-based.dto';

export interface DEuroPositionGraphDto extends FrankencoinBasedCollateralDto {
  id: string;
  position: string;
  owner: string;
  deuro: string;
  price: string;
  limitForClones: string;
  availableForClones: string;
  minted: string;
  reserveContribution: number;
  expiration: string;
  closed: boolean;
  denied: boolean;
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
