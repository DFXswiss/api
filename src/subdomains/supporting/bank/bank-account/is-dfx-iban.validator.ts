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
import { BankAccountService } from './bank-account.service';

export enum IbanType {
  BUY = 'Buy',
  SELL = 'Sell',
  BOTH = 'Both',
}

@ValidatorConstraint({ name: 'IsDfxIban', async: true })
@Injectable()
export class IsDfxIbanValidator implements ValidatorConstraintInterface {
  constructor(
    private readonly specialExternalAccountService: SpecialExternalAccountService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  private blockedIbans: string[] = [];
  private blockedBICs: string[] = [];
  private currentBIC: string = undefined;

  async validate(_: string, args: ValidationArguments) {
    // blacklist types
    const type = args.constraints[0];
    const types = [SpecialExternalAccountType.BANNED_IBAN, SpecialExternalAccountType.BANNED_BIC];
    if ([IbanType.BUY, IbanType.BOTH].includes(type))
      types.push(SpecialExternalAccountType.BANNED_IBAN_BUY, SpecialExternalAccountType.BANNED_BIC_BUY);
    if ([IbanType.SELL, IbanType.BOTH].includes(type))
      types.push(SpecialExternalAccountType.BANNED_IBAN_SELL, SpecialExternalAccountType.BANNED_BIC_SELL);

    const blacklists = await this.specialExternalAccountService.getBlacklist(types);

    this.blockedIbans = blacklists
      .filter((b) =>
        [
          SpecialExternalAccountType.BANNED_IBAN,
          SpecialExternalAccountType.BANNED_IBAN_BUY,
          SpecialExternalAccountType.BANNED_IBAN_SELL,
        ].includes(b.type),
      )
      .map((b) => b.value);
    this.blockedBICs = blacklists
      .filter((b) =>
        [
          SpecialExternalAccountType.BANNED_BIC,
          SpecialExternalAccountType.BANNED_BIC_BUY,
          SpecialExternalAccountType.BANNED_BIC_SELL,
        ].includes(b.type),
      )
      .map((b) => b.value);

    this.currentBIC = await this.bankAccountService.getOrCreateBankAccountInternal(args.value).then((b) => b.bic);

    return this.defaultMessage(args) == null;
  }

  defaultMessage(args: ValidationArguments): string | undefined {
    // IBAN tools
    const { valid } = IbanTools.validateIBAN(args.value);
    if (!valid) return `${args.property} not valid`;

    // check blocked IBANs
    const isBlocked = this.blockedIbans.some((i) => new RegExp(i.toLowerCase()).test(args.value.toLowerCase()));
    if (isBlocked) return `${args.property} not allowed`;

    if (this.blockedBICs.some((b) => new RegExp(b.toLowerCase()).test(this.currentBIC.toLowerCase())))
      return `${args.property} BIC not allowed`;
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
