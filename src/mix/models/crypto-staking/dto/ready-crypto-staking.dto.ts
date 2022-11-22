import { IsArray, IsNotEmpty } from 'class-validator';

export class ReadyCryptoStakingDto {
  @IsNotEmpty()
  @IsArray()
  ids: number[];
}
