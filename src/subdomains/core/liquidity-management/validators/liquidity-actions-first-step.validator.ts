import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { LiquidityManagementActionDto } from '../dto/input/liquidity-management-action.dto';

@ValidatorConstraint({ name: 'LiquidityActionsFirstStepValidator', async: false })
export class LiquidityActionsFirstStepValidator implements ValidatorConstraintInterface {
  validate(actions: LiquidityManagementActionDto[]) {
    if (!actions) return true;

    return actions[0] ? actions[0].stepNumber === 1 : false;
  }

  defaultMessage(args: ValidationArguments) {
    return `First action in ${args.property} must have a 'stepNumber' of 1`;
  }
}
