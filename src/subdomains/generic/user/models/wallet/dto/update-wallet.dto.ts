import { IsEnum, IsOptional } from 'class-validator';
import { AmlRule } from '../wallet.entity';
import { WalletDto } from './wallet.dto';

export class UpdateWalletDto extends WalletDto {
  @IsOptional()
  @IsEnum(AmlRule)
  amlRule: AmlRule;
}
