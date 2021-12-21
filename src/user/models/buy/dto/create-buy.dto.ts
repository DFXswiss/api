import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { Asset } from 'src/shared/models/asset/asset.entity';

export class CreateBuyDto {
  @ApiProperty()
  @IsNotEmpty()
  // @IsIBAN()
  iban: string;

  @ApiProperty()
  @IsNotEmpty()
  asset: Asset;
}
