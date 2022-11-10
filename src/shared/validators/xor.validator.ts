import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

@ValidatorConstraint({ name: 'XOR', async: false })
export class XOR implements ValidatorConstraintInterface {
  validate(propertyValue: any, args: ValidationArguments) {
    return (
      (!!propertyValue && !args.object[args.constraints[0]]) || (!propertyValue && !!args.object[args.constraints[0]])
    );
  }

  defaultMessage(args: ValidationArguments) {
    return `Failed XOR relation between "${args.property}" and "${args.constraints[0]}"`;
  }
}
