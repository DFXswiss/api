export class CreatePaymentDto {
  clientId: number;
  comment: string;
  currencyCode: string;
  executionDate: string;
  externalId: string;
  nominalAmount: number;
  recidivism: false;
}
