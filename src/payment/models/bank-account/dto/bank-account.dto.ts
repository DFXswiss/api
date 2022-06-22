export interface BankAccountDto {
  bic: string;
  allBicCandidates: string;
  country: string;
  bankCode: string;
  bankAndBranchCode: string;
  bankName: string;
  bankAddress: string;
  bankCity: string;
  bankState: string;
  bankPostalCode: string;
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
}
