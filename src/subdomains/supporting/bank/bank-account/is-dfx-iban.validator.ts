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
import { Bank } from '../bank/bank.entity';
import { BankService } from '../bank/bank.service';
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
    private readonly bankService: BankService,
  ) {}

  private blockedIbans: string[] = [];
  private blockedBICs: string[] = [];
  private dfxBanks: Bank[] = [];
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

    this.dfxBanks = await this.bankService.getAllBanks();

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

    this.currentBIC = await this.bankAccountService.getOrCreateIbanBankAccountInternal(args.value).then((b) => b.bic);

    return this.defaultMessage(args) == null;
  }

  defaultMessage(args: ValidationArguments): string | undefined {
    const iban = args.value;
    if (!iban) return 'IBAN required';

    // IBAN tools
    const { valid } = IbanTools.validateIBAN(iban);
    if (!valid || (!this.currentBIC && !iban.startsWith('CH') && !iban.startsWith('LI')))
      return `${args.property} not valid`;

    // check blocked IBANs
    const isBlocked = this.blockedIbans.some((i) => new RegExp(i.toLowerCase()).test(iban.toLowerCase()));
    if (isBlocked) return `${args.property} not allowed`;

    if (this.blockedBICs.some((b) => new RegExp(b.toLowerCase()).test(this.currentBIC?.toLowerCase())))
      return `${args.property} BIC not allowed`;

    if (this.dfxBanks.some((b) => b.iban.toLowerCase() === iban.toLowerCase()))
      return `${args.property} DFX IBAN not allowed`;

    // check if QR IBAN
    if (iban.startsWith('CH') || iban.startsWith('LI')) {
      const iid = +iban.substring(4, 9);
      if (iid >= 30000 && iid <= 31999) return `${args.property} QR IBAN not allowed`;
    }
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
