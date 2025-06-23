import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNotEmptyObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Util } from 'src/shared/utils/util';
import { IbanType, IsDfxIban } from 'src/subdomains/supporting/bank/bank-account/is-dfx-iban.validator';

export class CreateSellDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @IsDfxIban(IbanType.SELL)
  @Transform(Util.trimAll)
  iban: string;

  // TODO: remove
  @ApiProperty({ type: EntityDto, deprecated: true, description: 'Use the currency property' })
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  fiat?: Fiat;

  @ApiProperty({ type: EntityDto })
  @IsNotEmptyObject()
  @ValidateIf((dto: CreateSellDto) => Boolean(dto.currency || !dto.fiat))
  @ValidateNested()
  @Type(() => EntityDto)
  currency: Fiat;

  @ApiProperty({ enum: Blockchain, default: Blockchain.BITCOIN })
  @IsNotEmpty()
  @IsEnum(Blockchain)
  blockchain: Blockchain = Blockchain.BITCOIN;
}
