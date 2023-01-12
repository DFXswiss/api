import { Injectable } from '@nestjs/common';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import ibantools from 'ibantools';

export const REQUEST_CONTEXT = '_requestContext';

@ValidatorConstraint({ name: 'IsDfxIban', async: true })
@Injectable()
export class IsDfxIbanValidator implements ValidatorConstraintInterface {
  private blockedIbans = ['LT..37800000', 'AT..14200200', 'AT..20602099', 'LT..60378000'];

  async validate(iban: string) {
    try {
      iban = iban.split(' ').join('');

      //Iban Tools
      const { valid } = ibantools.validateIBAN(iban);
      if (!valid) return false;

      // check blocked IBANs
      const blockedIban = this.blockedIbans.find((i) => i.split(' ').join('').toLowerCase() === iban);
      if (blockedIban) return false;
    } catch (e) {
      return false;
    }

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
