import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TfaLevel, TfaService } from '../services/tfa.service';

// Enforces a valid 2FA verification (TfaLevel.STRICT) on staff endpoints for mail-origin sessions only.
// A staff role reached via the weaker mail-magic-link factor carries request.user.tfaRequired (stamped when
// the token is minted, see AuthService.generateUserToken); wallet-signature logins never carry it and pass
// through unchanged. Enforcement thus follows the mail-origin marker, not the feature flag: turning off
// Config.auth.tfaStaffEnforced stops NEW mail elevations but never un-gates a residual mail-minted token.
// Place AFTER AuthGuard/RoleGuard so request.user is populated. Reuses the existing TfaService;
// throws TfaRequiredException (403, code TFA_REQUIRED) which the staff frontend handles.
@Injectable()
export class TfaGuard implements CanActivate {
  // A controller-scoped guard is instantiated in its host module's DI context. TfaService lives deep in the
  // KYC graph (with circular deps), so injecting it directly would force every staff-controller module to
  // import KycModule. Instead we depend only on ModuleRef (available everywhere) and resolve the TfaService
  // singleton lazily at request time.
  constructor(private readonly moduleRef: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Only mail-origin staff sessions (tfaRequired) require 2FA; wallet-signature logins are unaffected.
    if (!request.user?.tfaRequired) return true;

    const userDataId = request.user?.account;
    if (!userDataId) throw new ForbiddenException('User not authenticated');

    // live request IP (mirrors RealIP), so the check matches the IP the 2FA log was written with
    const ip = request.realIp ?? request.socket?.remoteAddress ?? 'unknown';

    const tfaService = this.moduleRef.get(TfaService, { strict: false });
    await tfaService.check(userDataId, ip, TfaLevel.STRICT);
    return true;
  }
}
