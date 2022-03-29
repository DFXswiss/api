import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateCryptoInputDto {
  @IsNotEmpty()
  @IsBoolean()
  isReturned: boolean;
}
