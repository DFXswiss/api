import { Type } from 'class-transformer';
import { IsDate, IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateMasternodeDto {
  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  creationDate: Date;

  @IsNotEmpty()
  @IsString()
  creationHash: string;

  @IsNotEmpty()
  @IsString()
  owner: string;

  @IsNotEmpty()
  @IsInt()
  timelock: number;
}
