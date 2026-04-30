import { IsNotEmpty, IsString } from 'class-validator';

export class IpBlacklistDto {
  @IsNotEmpty()
  @IsString()
  ip: string;
}
