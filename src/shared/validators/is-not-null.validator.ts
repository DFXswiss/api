import {
  registerDecorator,
  ValidateIf,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'IsNotNull' })
export class IsNotNullValidator implements ValidatorConstraintInterface {
  validate(value: any) {
    // undefined = ok (optional)
    if (value === undefined) return true;

    // null = verboten
    if (value === null) return false;

    // alle anderen Werte = ok
    return true;
  }

  defaultMessage(args: ValidationArguments) {
    return `Null is not allowed for ${args.property}`;
  }
}

function IsNotNull(validationOptions?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'IsNotNull',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsNotNullValidator,
    });
  };
}

export function IsOptionalButNotNull(validationOptions?: any) {
  return function (target: any, propertyName: string) {
    ValidateIf((_obj, value) => value !== undefined)(target, propertyName);

    IsNotNull(validationOptions)(target, propertyName);
  };
}
