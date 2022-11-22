import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import { LiquidityManagementActionDto } from '../dto/input/liquidity-management-action.dto';

@ValidatorConstraint({ name: 'LiquidityActionsAllStepsMatchValidator', async: false })
export class LiquidityActionsAllStepsMatchValidator implements ValidatorConstraintInterface {
  validate(actions: LiquidityManagementActionDto[] = []) {
    return actions.every(
      (a) =>
        (a.stepNumberOnSuccess ? !!actions.find((_a) => _a.stepNumber === a.stepNumberOnSuccess) : true) &&
        (a.stepNumberOnFail ? !!actions.find((_a) => _a.stepNumber === a.stepNumberOnFail) : true),
    );
  }

  defaultMessage(args: ValidationArguments) {
    return `Action steps in ${args.property} contain onSuccess/onFail references that are missing in provided path`;
  }
}
