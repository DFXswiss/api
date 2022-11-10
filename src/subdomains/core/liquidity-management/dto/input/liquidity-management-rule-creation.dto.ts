import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AND } from 'src/shared/validators/and.validator';
import { OR } from 'src/shared/validators/or.validator';
import { XOR } from 'src/shared/validators/xor.validator';
import { LiquidityManagementContext } from '../../enums';
import { LiquidityActionsAllStepsMatchValidator } from '../../validators/liquidity-actions-all-steps-match.validator';
import { LiquidityActionsFirstStepValidator } from '../../validators/liquidity-actions-first-step.validator';
import { LiquidityActionsNoDuplicateStepsValidator } from '../../validators/liquidity-actions-no-duplicate-steps.validator';
import { LiquidityManagementActionDto } from './liquidity-management-action.dto';

export class LiquidityManagementRuleCreationDto {
  @IsNotEmpty()
  @IsEnum(LiquidityManagementContext)
  context: LiquidityManagementContext;

  @ValidateIf((dto) => dto.targetAssetId || (!dto.targetAssetId && !dto.targetFiatId))
  @Validate(XOR, ['targetFiatId'])
  @IsInt()
  targetAssetId: number;

  @ValidateIf((dto) => dto.targetFiatId || (!dto.targetAssetId && !dto.targetFiatId))
  @Validate(XOR, ['targetAssetId'])
  @IsInt()
  targetFiatId: number;

  @ValidateIf((dto) => dto.minimum || (!dto.maximum && !dto.minimum))
  @Validate(OR, ['maximum'])
  @Validate(AND, ['deficitActions'])
  @IsNumber()
  minimum: number;

  @IsNotEmpty()
  @IsNumber()
  optimal: number;

  @ValidateIf((dto) => dto.maximum || (!dto.maximum && !dto.minimum))
  @Validate(OR, ['minimum'])
  @Validate(AND, ['redundancyActions'])
  @IsNumber()
  maximum: number;

  @ValidateIf((dto) => dto.minimum)
  @IsArray()
  @ArrayMinSize(1)
  @Validate(LiquidityActionsFirstStepValidator)
  @Validate(LiquidityActionsAllStepsMatchValidator)
  @Validate(LiquidityActionsNoDuplicateStepsValidator)
  @ValidateNested({ each: true })
  @Type(() => LiquidityManagementActionDto)
  deficitActions: LiquidityManagementActionDto[];

  @ValidateIf((dto) => dto.maximum)
  @IsArray()
  @ArrayMinSize(1)
  @Validate(LiquidityActionsFirstStepValidator)
  @Validate(LiquidityActionsAllStepsMatchValidator)
  @Validate(LiquidityActionsNoDuplicateStepsValidator)
  @ValidateNested({ each: true })
  @Type(() => LiquidityManagementActionDto)
  redundancyActions: LiquidityManagementActionDto[];
}
