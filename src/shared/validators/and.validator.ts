import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

@ValidatorConstraint({ name: 'AND', async: false })
export class AND implements ValidatorConstraintInterface {
  validate(propertyValue: any, args: ValidationArguments) {
    return (
      (!!propertyValue && args.object[args.constraints[0]]) || (propertyValue && !!args.object[args.constraints[0]])
    );
  }

  defaultMessage(args: ValidationArguments) {
    return `Failed AND relation between "${args.property}" and "${args.constraints[0]}"`;
  }
}
