import { SepaAmount, SepaCdi } from './sepa.dto';
import { SepaEntry } from './sepa-entry.dto';

export interface SepaFile {
  BkToCstmrStmt: {
    Stmt: {
      Id: number; // unique
      ElctrncSeqNb: string;
      CreDtTm: string;
      FrToDt: {
        FrDtTm: string;
        ToDtTm: string;
      };
      CpyDplctInd: string;
      Acct: {
        Id: {
          IBAN: string;
        };
      };
      Bal: [
        {
          Amt: SepaAmount;
          CdtDbtInd: SepaCdi;
        },
        {
          Amt: SepaAmount;
          CdtDbtInd: SepaCdi;
        },
      ];
      TxsSummry: {
        TtlNtries: {
          NbOfNtries: string;
          TtlNetNtry: {
            Amt: string;
            CdtDbtInd: SepaCdi;
          };
        };
        TtlCdtNtries: {
          NbOfNtries: string;
          Sum: string;
        };
        TtlDbtNtries: {
          NbOfNtries: string;
          Sum: string;
        };
      };
      Ntry: SepaEntry | SepaEntry[];
    };
  };
}
