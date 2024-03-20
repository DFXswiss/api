import { Injectable } from '@nestjs/common';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import * as ibantools from 'ibantools';
import { SpecialExternalAccountType } from '../special-external-account/special-external-account.entity';
import { SpecialExternalAccountService } from '../special-external-account/special-external-account.service';

@ValidatorConstraint({ name: 'IsDfxIban', async: true })
@Injectable()
export class IsDfxIbanValidator implements ValidatorConstraintInterface {
  constructor(private readonly specialExternalAccountService: SpecialExternalAccountService) {}

  private blockedIbans: string[] = [];

  async validate(_: string, args: ValidationArguments) {
    this.blockedIbans = await this.specialExternalAccountService
      .getBlacklist(SpecialExternalAccountType.BANNED_IBAN)
      .then((s) => s.map((b) => b.value));
    return this.defaultMessage(args) == null;
  }

  defaultMessage(args: ValidationArguments): string | undefined {
    // IBAN tools
    const { valid } = ibantools.validateIBAN(args.value);
    if (!valid) return `${args.property} not valid`;

    // check blocked IBANs
    const isBlocked = this.blockedIbans.some((i) => new RegExp(i.toLowerCase()).test(args.value.toLowerCase()));
    if (isBlocked) return `${args.property} not allowed`;
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
