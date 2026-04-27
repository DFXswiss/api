import { ForbiddenException } from '@nestjs/common';

export class TfaRequiredException extends ForbiddenException {
  constructor(public readonly level?: string) {
    super({
      code: '2FA_REQUIRED',
      message: `2FA required${level ? ` (${level.toLowerCase()})` : ''}`,
      level: level?.toLowerCase(),
    });
  }
}
