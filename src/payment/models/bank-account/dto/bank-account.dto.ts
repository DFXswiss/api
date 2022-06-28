export interface BankAccountInfos {
  result: string;
  returnCode: number;
  checks: string;
  bic: string;
  allBicCandidates: string;
  bankCode: string;
  bankAndBranchCode: string;
  bankName: string;
  bankAddress: string;
  bankUrl: string;
  branch: string;
  branchCode: string;
  sct: boolean;
  sdd: boolean;
  b2b: boolean;
  scc: boolean;
  sctInst: boolean;
  sctInstReadinessDate: Date;
  acountNumber: string;
  dataAge: string;
  ibanListed: string;
  ibanWwwOccurrences: number;
}
