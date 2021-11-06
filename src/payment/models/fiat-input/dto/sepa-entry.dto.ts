import { SepaAddress, SepaAgent, SepaAmount, SepaCdi } from "./sepa.dto";

export interface SepaEntry {
  BookgDt: {
    Dt: string;
  };
  ValDt: {
    Dt: string;
  };
  NtryDtls: {
    Btch: {
      NbOfTxs: string;
    };
    TxDtls: {
      Refs: {
        AcctSvcrRef: string;
        EndToEndId: string;
        InstrId: string;
        TxId: string;
      };
      Amt: SepaAmount;
      CdtDbtInd: SepaCdi;
      AmtDtls: {
        InstdAmt: {
          Amt: SepaAmount;
        };
        TxAmt: {
          Amt: SepaAmount;
          CcyXchg: {
            SrcCcy: string;
            TrgtCcy: string;
            XchgRate: string;
          };
        };
      };
      Chrgs: {
        Rcrd: {
          Amt: SepaAmount;
          CdtDbtInd: SepaCdi;
        };
      };
      RltdPties: {
        Dbtr: {
          Nm: string;
          PstlAdr: SepaAddress;
        };
        DbtrAcct: {
          Id: {
            IBAN: string;
          };
        };
        Cdtr: {
          Nm: string;
          PstlAdr: SepaAddress;
        };
        CdtrAcct: {
          Id: {
            IBAN: string;
          };
        };
      };
      RltdAgts: {
        DbtrAgt: SepaAgent;
        CdtrAgt: SepaAgent;
      };
      RmtInf: {
        Ustrd: string;
      };
      AddtlTxInf: string;
    };
  };
}
