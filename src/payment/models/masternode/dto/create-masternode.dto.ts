import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class CreateMasternodeDto {
  @IsNotEmpty()
  @IsString()
  hash: string;

  @IsNotEmpty()
  @IsString()
  owner: string;

  @IsNotEmpty()
  @IsString()
  operator: string;

  @IsNotEmpty()
  @IsString()
  server: string;

  @IsNotEmpty()
  @IsInt()
  timelock: number;
}
