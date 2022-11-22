import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { LiquidityManagementActionDto } from '../dto/input/liquidity-management-action.dto';

@ValidatorConstraint({ name: 'LiquidityActionsNoDuplicateStepsValidator', async: false })
export class LiquidityActionsNoDuplicateStepsValidator implements ValidatorConstraintInterface {
  validate(actions: LiquidityManagementActionDto[] = []) {
    const isDuplicatedSteps = actions.some(
      (a, index) => actions.findIndex((_a) => a.stepNumber === _a.stepNumber) !== index,
    );

    return !isDuplicatedSteps;
  }

  defaultMessage(args: ValidationArguments) {
    return `Action steps in ${args.property} contain duplicated stepNumber declarations`;
  }
}
