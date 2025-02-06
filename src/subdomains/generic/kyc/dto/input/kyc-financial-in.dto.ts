import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class KycFinancialResponse {
  @ApiProperty({ description: 'Question key' })
  @IsNotEmpty()
  @IsString()
  key: string;

  @ApiProperty({ description: 'Response value (option key(s) or plain text)' })
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  value: string;
}

export class KycFinancialInData {
  @ApiProperty({ type: KycFinancialResponse, isArray: true })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KycFinancialResponse)
  responses: KycFinancialResponse[];
}
