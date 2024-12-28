import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { XOR } from 'src/shared/validators/xor.validator';
import { CardBankName, IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { LiquidityManagementContext } from '../../enums';
import { LiquidityActionsAllStepsMatchValidator } from '../../validators/liquidity-actions-all-steps-match.validator';
import { LiquidityActionsFirstStepValidator } from '../../validators/liquidity-actions-first-step.validator';
import { LiquidityActionsNoDuplicateStepsValidator } from '../../validators/liquidity-actions-no-duplicate-steps.validator';
import { LiquidityManagementActionDto } from './liquidity-management-action.dto';

export class LiquidityManagementRuleCreationDto {
  @IsNotEmpty()
  @IsEnum([Blockchain, IbanBankName, CardBankName, ExchangeName])
  context: LiquidityManagementContext;

  @ValidateIf((dto) => dto.targetAssetId || (!dto.targetAssetId && !dto.targetFiatId))
  @Validate(XOR, ['targetFiatId'])
  @IsInt()
  targetAssetId: number;

  @ValidateIf((dto) => dto.targetFiatId || (!dto.targetAssetId && !dto.targetFiatId))
  @Validate(XOR, ['targetAssetId'])
  @IsInt()
  targetFiatId: number;

  @ValidateIf((dto) => dto.minimal != null || dto.maximal == null || dto.deficitActions)
  @IsNumber()
  @Min(0)
  minimal: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  optimal: number;

  @ValidateIf((dto) => dto.maximal != null || dto.minimal == null || dto.redundancyActions)
  @IsNumber()
  @Min(0)
  maximal: number;

  @ValidateIf((dto) => dto.minimal)
  @IsArray()
  @ArrayMinSize(1)
  @Validate(LiquidityActionsFirstStepValidator)
  @Validate(LiquidityActionsAllStepsMatchValidator)
  @Validate(LiquidityActionsNoDuplicateStepsValidator)
  @ValidateNested({ each: true })
  @Type(() => LiquidityManagementActionDto)
  deficitActions: LiquidityManagementActionDto[];

  @ValidateIf((dto) => dto.maximal)
  @IsArray()
  @ArrayMinSize(1)
  @Validate(LiquidityActionsFirstStepValidator)
  @Validate(LiquidityActionsAllStepsMatchValidator)
  @Validate(LiquidityActionsNoDuplicateStepsValidator)
  @ValidateNested({ each: true })
  @Type(() => LiquidityManagementActionDto)
  redundancyActions: LiquidityManagementActionDto[];

  @IsOptional()
  @IsInt()
  reactivationTime?: number;
}
