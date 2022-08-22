import { Injectable, Optional } from '@nestjs/common';

export class BankInfoDto {
  receiveName: string;
  location: string;
  zipLocation: string;
  country: string;
  iban: string;
  bic: string;
}

export class BuyPaymentInfoDto extends BankInfoDto {
  fee: number;
  bankUsage: string;
  refBonus: number;
}

export function GetBankInfo(): BankInfoClass {
  return new BankInfoClass();
}

export class BankInfoClass {
  dfxInfo = {
    receiveName: 'DFX AG',
    location: 'Bahnhofstrasse 7',
    zipLocation: '6300 Zug',
    country: 'Schweiz',
  };

  maerki = {
    iban: 'CH6808573177975201814',
    bic: 'MAEBCHZZ',
  };

  olky = {
    iban: 'LU116060002000005040',
    bic: 'OLKILUL1',
  };
}

@Injectable()
export class BankInfoService {
  constructor(@Optional() readonly bankInfo?: BankInfoClass) {
    BankInfo = bankInfo ?? GetBankInfo();
  }
}

export let BankInfo: BankInfoClass;

export enum Bank {
  MAERKI = 'MaerkiBaumann',
  OLKY = 'Olky',
}
