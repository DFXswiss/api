import { IsNotEmpty, IsString } from 'class-validator';

export class ManualPassAmlCheckDto {
  @IsNotEmpty()
  @IsString()
  responsible: string;
}
