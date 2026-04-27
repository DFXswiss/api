import { ForbiddenException } from '@nestjs/common';
import type { TfaLevel } from '../services/tfa.service';

export class TfaRequiredException extends ForbiddenException {
  constructor(public readonly level?: TfaLevel) {
    const lowerLevel = level?.toLowerCase();
    super({
      code: 'TFA_REQUIRED',
      message: `2FA required${lowerLevel ? ` (${lowerLevel})` : ''}`,
      level: lowerLevel,
    });
  }
}
