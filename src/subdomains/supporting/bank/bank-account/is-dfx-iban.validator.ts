import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import * as ibantools from 'ibantools';

@ValidatorConstraint({ name: 'IsDfxIban' })
export class IsDfxIbanValidator implements ValidatorConstraintInterface {
  private blockedIban = ['LT..37800000', 'AT..14200200', 'AT..20602099', 'LT..60378000'];

  validate(_: string, args: ValidationArguments) {
    return this.defaultMessage(args) == null;
  }

  defaultMessage(args: ValidationArguments): string | undefined {
    //Iban Tools
    const { valid } = ibantools.validateIBAN(args.value);
    if (!valid) return 'IBAN not valid';

    // check blocked IBANs
    const isBlocked = this.blockedIban.some((i) => args.value.toLowerCase().match(i.toLowerCase()) != null);
    if (isBlocked) return 'IBAN not allowed';
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
