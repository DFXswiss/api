import { Transform, Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CheckoutReverse } from 'src/integration/checkout/services/checkout.service';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Util } from 'src/shared/utils/util';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { FiatOutput } from 'src/subdomains/supporting/fiat-output/fiat-output.entity';

export class RefundInternalDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  refundUser: User;

  @IsOptional()
  @IsString()
  @Transform(Util.trimAll)
  refundIban: string;

  @IsOptional()
  @IsNumber()
  chargebackAmount: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  chargebackAllowedDate: Date;

  @IsOptional()
  @IsString()
  chargebackAllowedBy: string;
}

export class BaseRefund {
  chargebackAmount?: number;
  chargebackAllowedDate?: Date;
  chargebackAllowedDateUser?: Date;
  chargebackAllowedBy?: string;
}

export class BankTxRefund extends BaseRefund {
  refundIban?: string;
  chargebackOutput?: FiatOutput;
}

export class CheckoutTxRefund extends BaseRefund {
  chargebackRemittanceInfo?: CheckoutReverse;
}

export class CryptoInputRefund extends BaseRefund {
  refundUserAddress?: string;
  refundUserId?: number;
}
