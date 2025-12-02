import { registerDecorator, ValidationArguments, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'IsPastDate' })
export class IsPastDateValidator implements ValidatorConstraintInterface {
  validate(value: Date) {
    if (!(value instanceof Date)) return false;
    return value < new Date();
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must be a date in the past`;
  }
}

export function IsPastDate(validationOptions?: ValidationOptions) {
  return function (target: any, propertyName: string) {
    registerDecorator({
      name: 'IsPastDate',
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsPastDateValidator,
    });
  };
}
