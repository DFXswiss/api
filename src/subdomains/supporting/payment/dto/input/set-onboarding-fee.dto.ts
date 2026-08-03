import { IsNotEmpty, IsNumber, IsPositive } from 'class-validator';

export class SetOnboardingFeeDto {
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  amount: number; // CHF
}
