export class CreateInstantPaymentDto {
  clientId: number;
  paymentId: number;
  comment: string;
  externalId: string;
  nominalAmount: number;
}
