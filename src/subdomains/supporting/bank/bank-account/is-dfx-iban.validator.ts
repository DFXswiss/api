import { Injectable } from '@nestjs/common';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import * as IbanTools from 'ibantools';
import { SpecialExternalAccountType } from '../../payment/entities/special-external-account.entity';
import { SpecialExternalAccountService } from '../../payment/services/special-external-account.service';

export enum IbanType {
  BUY = 'Buy',
  SELL = 'Sell',
  BOTH = 'Both',
}

@ValidatorConstraint({ name: 'IsDfxIban', async: true })
@Injectable()
export class IsDfxIbanValidator implements ValidatorConstraintInterface {
  constructor(private readonly specialExternalAccountService: SpecialExternalAccountService) {}

  private blockedIbans: string[] = [];

  async validate(_: string, args: ValidationArguments) {
    // blacklist types
    const type = args.constraints[0];
    const types = [SpecialExternalAccountType.BANNED_IBAN];
    if ([IbanType.BUY, IbanType.BOTH].includes(type)) types.push(SpecialExternalAccountType.BANNED_IBAN_BUY);
    if ([IbanType.SELL, IbanType.BOTH].includes(type)) types.push(SpecialExternalAccountType.BANNED_IBAN_SELL);

    this.blockedIbans = await this.specialExternalAccountService.getBlacklist(types).then((s) => s.map((b) => b.value));
    return this.defaultMessage(args) == null;
  }

  defaultMessage(args: ValidationArguments): string | undefined {
    // IBAN tools
    const { valid } = IbanTools.validateIBAN(args.value);
    if (!valid) return `${args.property} not valid`;

    // check blocked IBANs
    const isBlocked = this.blockedIbans.some((i) => new RegExp(i.toLowerCase()).test(args.value.toLowerCase()));
    if (isBlocked) return `${args.property} not allowed`;
  }
}

export function IsDfxIban(type: IbanType, validationOptions?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'IsDfxIban',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: IsDfxIbanValidator,
      constraints: [type],
    });
  };
}
