import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Config } from 'src/config/config';

@ValidatorConstraint({ name: 'IsSwissPaymentText' })
export class IsSwissPaymentTextValidator implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (value == null || value === '') return true;
    return typeof value === 'string' && Config.formats.swissPaymentText.test(value);
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must only contain characters permitted in Swiss payment systems`;
  }
}

export function IsSwissPaymentText(validationOptions?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'IsSwissPaymentText',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsSwissPaymentTextValidator,
    });
  };
}
