import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNotEmptyObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

export class GetSellPaymentInfoDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  iban: string;

  @ApiProperty()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  currency: Fiat;

  @ApiProperty()
  @IsNotEmpty()
  @IsOptional()
  @IsEnum(Blockchain)
  blockchain: Blockchain = Blockchain.DEFICHAIN;
}
