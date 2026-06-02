import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { IsSwissPaymentText } from 'src/shared/validators/is-swiss-payment-text.validator';

export class UserNameDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @IsSwissPaymentText()
  firstName: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @IsSwissPaymentText()
  lastName: string;
}
