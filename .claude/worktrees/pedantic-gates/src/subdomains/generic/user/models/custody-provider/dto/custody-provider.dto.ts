import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CustodyProviderDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  mail: string;

  @IsNotEmpty()
  @IsString()
  masterKey: string;
}
