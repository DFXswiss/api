import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import * as libphonenumber from 'google-libphonenumber';

@ValidatorConstraint({ name: 'IsDfxPhone' })
export class IsDfxPhoneValidator implements ValidatorConstraintInterface {
  validate(phoneNumber: string) {
    try {
      const phoneUtil = libphonenumber.PhoneNumberUtil.getInstance();
      return (
        phoneNumber &&
        phoneNumber.match(/^\+[\d ]*$/) &&
        phoneUtil.isValidNumber(phoneUtil.parseAndKeepRawInput(phoneNumber))
      );
    } catch (_) {
      return false;
    }
  }

  defaultMessage() {
    return `Phone number not valid`;
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
