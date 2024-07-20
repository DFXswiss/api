import { IsEnum, IsNotEmpty } from 'class-validator';
import { AmlRule } from '../wallet.entity';
import { WalletDto } from './wallet.dto';

export class CreateWalletDto extends WalletDto {
  @IsNotEmpty()
  @IsEnum(AmlRule)
  amlRule: AmlRule;
}
