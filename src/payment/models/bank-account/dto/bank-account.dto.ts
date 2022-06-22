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
  branchCode: number;
  sct: boolean;
  sdd: boolean;
  b2b: boolean;
  scc: boolean;
  sctInst: boolean;
  sctInstReadinessDate: string;
  acountNumber: number;
  dataAge: string;
  ibanListed: string;
}
