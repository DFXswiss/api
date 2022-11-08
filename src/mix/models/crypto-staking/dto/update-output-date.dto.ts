import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty } from 'class-validator';

export class UpdateOutputDateDto {
  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  outputDate: Date;
}
