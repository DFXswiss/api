import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

@ValidatorConstraint({ name: 'OR', async: false })
export class OR implements ValidatorConstraintInterface {
  validate(propertyValue: any, args: ValidationArguments) {
    return !!(propertyValue || args.object[args.constraints[0]]);
  }

  defaultMessage(args: ValidationArguments) {
    return `Failed OR relation between "${args.property}" and "${args.constraints[0]}"`;
  }
}
