import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { User } from 'src/user/user.entity';

export class CreateSellDto {

  @ApiProperty()
  @IsNotEmpty()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  fiat: any;

  user: User;

  @IsOptional()
  deposit: any;
}
