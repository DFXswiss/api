import { Injectable } from '@nestjs/common';
import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import ibantools from 'ibantools';

@ValidatorConstraint({ name: 'IsDfxIban' })
export class IsDfxIbanValidator implements ValidatorConstraintInterface {
  private blockedIbans = ['LT..37800000', 'AT..14200200', 'AT..20602099', 'LT..60378000'];

  async validate(iban: string) {
    //Iban Tools
    const { valid } = ibantools.validateIBAN(iban);
    if (!valid) return false;

    // check blocked IBANs
    const isBlocked = this.blockedIbans.some((i) => iban.toLowerCase().match(i.toLowerCase()) != null);
    if (isBlocked) return false;

    return true;
  }

  defaultMessage() {
    return `IBAN not valid`;
  }
}

export function IsDfxIban(validationOptions?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'IsDfxIban',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsDfxIbanValidator,
    });
  };
}
