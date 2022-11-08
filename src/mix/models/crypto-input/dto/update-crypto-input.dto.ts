import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateCryptoInputDto {
  @IsNotEmpty()
  @IsString()
  returnTxId: string;
}
