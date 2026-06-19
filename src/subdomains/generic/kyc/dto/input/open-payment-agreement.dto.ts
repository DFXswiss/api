import { IsInt, IsNotEmpty } from 'class-validator';

export class OpenPaymentAgreementDto {
  @IsNotEmpty()
  @IsInt()
  userDataId: number;
}
