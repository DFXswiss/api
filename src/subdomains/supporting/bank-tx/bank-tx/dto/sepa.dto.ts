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
      MmbId: number;
    };
    Nm: string;
    PstlAdr: SepaAddress;
  };
}

export interface ChargeRecord {
  Amt: SepaAmount;
  CdtDbtInd: SepaCdi;
}

export interface SepaAmount {
  '@_Ccy': string;
  '#text': string;
}

export enum SepaCdi {
  CREDIT = 'CRDT',
  DEBIT = 'DBIT',
}
