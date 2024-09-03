import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';

export class RefundInternalDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EntityDto)
  refundUser: User;

  @IsOptional()
  @IsString()
  refundIban: string;

  @IsOptional()
  @IsNumber()
  chargebackAmount: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  chargebackAllowedDate: Date;
}

export class BaseRefund {
  chargebackAmount?: number;
  chargebackAllowedDate?: Date;
}

export class BankTxRefund extends BaseRefund {
  refundIban: string;
}

export class CryptoInputRefund extends BaseRefund {
  refundUserAddress?: string;
  refundUserId?: number;
}
