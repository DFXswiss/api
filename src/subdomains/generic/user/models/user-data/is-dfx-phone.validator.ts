import { TransformFnParams } from 'class-transformer';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import PhoneNumber from 'libphonenumber-js';
import { Config } from 'src/config/config';

@ValidatorConstraint({ name: 'IsDfxPhone' })
export class IsDfxPhoneValidator implements ValidatorConstraintInterface {
  validate(phoneNumber: string) {
    try {
      return phoneNumber && phoneNumber.match(Config.formats.phone) && PhoneNumber(phoneNumber)?.isValid();
    } catch (_) {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} not valid`;
  }
}

export function IsDfxPhone(validationOptions?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'IsDfxPhone',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsDfxPhoneValidator,
    });
  };
}

export function DfxPhoneTransform({ value }: TransformFnParams): string | undefined {
  return value ? PhoneNumber(value)?.number : value;
}
