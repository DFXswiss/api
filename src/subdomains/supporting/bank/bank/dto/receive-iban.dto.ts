import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { ReceiveIbanStatus } from './receive-iban.enum';

export class CheckReceiveIbanDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  iban: string;
}

export class ReceiveIbanDto {
  @ApiProperty({ enum: ReceiveIbanStatus })
  status: ReceiveIbanStatus;
}
