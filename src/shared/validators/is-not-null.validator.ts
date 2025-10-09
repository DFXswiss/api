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
    return value !== null;
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} cannot be null`;
  }
}

export function IsOptionalButNotNull(validationOptions?: ValidationOptions) {
  return function (target: any, propertyName: string) {
    // skip all validation if undefined
    ValidateIf((_obj, value) => value !== undefined)(target, propertyName);

    registerDecorator({
      name: 'IsNotNull',
      target: target.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsNotNullValidator,
    });
  };
}

// function IsNotNull(validationOptions?: ValidationOptions) {
//   return function (object: any, propertyName: string) {
//     registerDecorator({
//       name: 'IsNotNull',
//       target: object.constructor,
//       propertyName: propertyName,
//       options: validationOptions,
//       validator: IsNotNullValidator,
//     });
//   };
// }

// export function IsOptionalButNotNull(validationOptions?: any) {
//   return function (target: any, propertyName: string) {
//     ValidateIf((_obj, value) => value !== undefined)(target, propertyName);

//     IsNotNull(validationOptions)(target, propertyName);
//   };
// }
