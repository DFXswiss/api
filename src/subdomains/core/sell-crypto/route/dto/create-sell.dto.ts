import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, IsString, ValidateNested } from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { IsDfxIban } from 'src/subdomains/supporting/bank/bank-account/is-dfx-iban.validator';

export class CreateSellDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.trimIban)
  @IsDfxIban()
  iban: string;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  fiat: Fiat;

  @ApiProperty({ enum: Blockchain, default: Blockchain.DEFICHAIN })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain = Blockchain.DEFICHAIN;
}
