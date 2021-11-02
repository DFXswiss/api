export interface SepaFile {
  BkToCstmrStmt: {
    Stmt: {
      Id: string; // unique
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
          Amt: {
            '@Ccy': string;
            '#text': string;
          };
          CdtDbtInd: string;
        },
        {
          Amt: {
            '@Ccy': string;
            '#text': string;
          };
          CdtDbtInd: string;
        },
      ];
      TxsSummry: {
        TtlNtries: {
          NbOfNtries: string;
          TtlNetNtry: {
            Amt: string;
            CdtDbtInd: string;
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
    };
  };
}
