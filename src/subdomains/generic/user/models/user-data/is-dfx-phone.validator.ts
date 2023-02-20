import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import * as libphonenumber from 'google-libphonenumber';

@ValidatorConstraint({ name: 'IsDfxPhone' })
export class IsDfxPhoneValidator implements ValidatorConstraintInterface {
  validate(_: string, args: ValidationArguments) {
    return this.defaultMessage(args) == null;
  }

  defaultMessage(args: ValidationArguments): string | undefined {
    try {
      const phoneUtil = libphonenumber.PhoneNumberUtil.getInstance();
      const phoneNumber = args.value;
      if (phoneNumber && !phoneNumber.match(/^\+\d+ .+$/)) {
        return 'Phone number format not valid';
      } else if (
        (phoneNumber && !phoneNumber.match(/^\+[\d ]*$/)) ||
        (phoneNumber && !phoneUtil.isValidNumber(phoneUtil.parseAndKeepRawInput(phoneNumber)))
      ) {
        return 'Phone number not valid';
      }
    } catch (_) {
      return 'Phone number not valid';
    }
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
