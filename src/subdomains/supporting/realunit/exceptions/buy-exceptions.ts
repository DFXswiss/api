import { ForbiddenException } from '@nestjs/common';

export class RegistrationRequiredException extends ForbiddenException {
  constructor(message = 'RealUnit registration required') {
    super({
      code: 'REGISTRATION_REQUIRED',
      message,
    });
  }
}

export class KycLevelRequiredException extends ForbiddenException {
  constructor(
    public readonly requiredLevel: number,
    public readonly currentLevel: number,
    message: string,
  ) {
    super({
      code: 'KYC_LEVEL_REQUIRED',
      message,
      requiredLevel,
      currentLevel,
    });
  }
}
