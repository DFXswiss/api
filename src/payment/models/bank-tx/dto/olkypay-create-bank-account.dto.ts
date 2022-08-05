export class CreateBankAccountDto {
  clientId: number;
  name: string;
  iban: string;
  countryCode: string;
  bankName: string;
  bankLocation: string;
}
