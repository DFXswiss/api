import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmptyObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Wallet } from '../../wallet/wallet.entity';

export class KycDataTransferDto {
  @ApiProperty()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  wallet: Wallet;
}
