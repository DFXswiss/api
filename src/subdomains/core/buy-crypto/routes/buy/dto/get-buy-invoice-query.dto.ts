import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { Util } from 'src/shared/utils/util';

export class GetBuyInvoiceQuery {
  @ApiPropertyOptional({
    description:
      'When true, issue the invoice against the collection account instead of the personal virtual IBAN stored on the request',
  })
  @IsOptional()
  @Transform(Util.mapBooleanQuery)
  collectionAccount?: boolean;
}
