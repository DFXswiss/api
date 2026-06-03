import { ForbiddenException } from '@nestjs/common';

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
