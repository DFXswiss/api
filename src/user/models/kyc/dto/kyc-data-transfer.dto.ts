import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmptyObject, ValidateNested } from 'class-validator';
import { Wallet } from 'ethers';
import { Type } from 'class-transformer';
import { EntityDto } from 'src/shared/dto/entity.dto';

export class KycDataTransferDto {
  @ApiProperty()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => EntityDto)
  wallet: Wallet;
}
