export interface SepaAddress {
  Ctry: string;
  StrtNm: string;
  BldgNb: string;
  PstCd: string;
  TwnNm: string;
  AdrLine: string | string[];
}

export interface SepaAgent {
  FinInstnId: {
    BICFI: string;
    ClrSysMmbId: {
      ClrSysId: {
        Cd: string;
      };
      MmbId: string;
    };
    Nm: string;
    PstlAdr: SepaAddress;
  };
}

export interface SepaAmount {
  '@_Ccy': string;
  '#text': string;
}

export enum SepaCdi {
  CREDIT = 'CRDT',
  DEBIT = 'DBIT',
}
