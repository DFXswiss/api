import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { User } from 'src/user/user.entity';

export class CreateSellDto {
  @IsOptional()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsNotEmpty()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  fiat: any;

  user: User;

  @IsOptional()
  deposit: any;

  @IsString()
  @IsOptional()
  created: Date;
}
