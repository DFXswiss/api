import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';

export class PrimaryEmailRequiredException extends BadRequestException {
  constructor(message: string) {
    super({
      code: QuoteError.PRIMARY_EMAIL_REQUIRED,
      message,
    });
  }
}

export class AmountTooLowException extends BadRequestException {
  constructor(message: string) {
    super({
      code: QuoteError.AMOUNT_TOO_LOW,
      message,
    });
  }
}

export class RegistrationRequiredException extends ForbiddenException {
  constructor(message = 'RealUnit registration required', context?: string) {
    super({
      code: 'REGISTRATION_REQUIRED',
      message,
      ...(context && { context }),
    });
  }
}

export class KycLevelRequiredException extends ForbiddenException {
  constructor(
    public readonly requiredLevel: number,
    public readonly currentLevel: number,
    message: string,
    context?: string,
  ) {
    super({
      code: 'KYC_LEVEL_REQUIRED',
      message,
      requiredLevel,
      currentLevel,
      ...(context && { context }),
    });
  }
}
