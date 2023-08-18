import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'XOR', async: false })
export class XOR implements ValidatorConstraintInterface {
  validate(propertyValue: any, args: ValidationArguments) {
    return (
      (!!propertyValue && !args.object[args.constraints[0]]) || (!propertyValue && !!args.object[args.constraints[0]])
    );
  }

  defaultMessage(args: ValidationArguments) {
    return `only set ${args.property} or ${args.constraints[0]}`;
  }
}
