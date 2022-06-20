import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString } from 'class-validator';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export class CreateSellDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsObject()
  fiat: Fiat;
}
