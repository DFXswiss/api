export interface FrankencoinPositionDto {
  id: string;
  position: string;
  owner: string;
  zchf: string;
  collateral: string;
  price: string;
}

export interface FrankencoinChallengeDto {
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

export interface FrankencoinFpsDto {
  id: string;
  profits: string;
  loss: string;
  reserve: string;
}

export interface FrankencoinMinterDto {
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

export interface FrankencoinDelegationDto {
  id: string;
  owner: string;
  delegatedTo: string;
  pureDelegatedFrom: [string];
}

export interface FrankencoinTradeDto {
  id: string;
  trader: string;
  amount: string;
  shares: string;
  price: string;
  time: string;
}

export interface FrankencoinLogInfoDto {
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
