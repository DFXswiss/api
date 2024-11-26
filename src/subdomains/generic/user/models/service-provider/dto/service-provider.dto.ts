import { IsOptional, IsString } from 'class-validator';

export class ServiceProviderDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  mail: string;

  @IsString()
  masterKey: string;
}
