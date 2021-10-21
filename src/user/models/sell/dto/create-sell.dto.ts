import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export class CreateSellDto {
  @ApiProperty()
  @IsNotEmpty()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  fiat: Fiat;
}
