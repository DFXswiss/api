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

// Single source of truth for phone normalization (E.164). Also used by comparisons against
// stored values, which may predate this normalization (introduced 2024-07) and therefore
// still carry their original formatting.
export function normalizeDfxPhone(value: string | undefined): string | undefined {
  return value ? PhoneNumber(value)?.number : value;
}

export function DfxPhoneTransform({ value }: TransformFnParams): string | undefined {
  return normalizeDfxPhone(value);
}
