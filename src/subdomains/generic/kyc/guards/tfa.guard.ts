import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Config } from 'src/config/config';
import { TfaLevel, TfaService } from '../services/tfa.service';

// Enforces a valid 2FA verification on staff endpoints, so a staff role obtained via the weaker
// mail-magic-link factor (or any login) is only usable with a true second factor (TfaLevel.STRICT).
// Place AFTER AuthGuard/RoleGuard so request.user is populated. Reuses the existing TfaService;
// throws TfaRequiredException (403, code TFA_REQUIRED) which the staff frontend already handles.
// Gated by Config.auth.tfaStaffEnforced (default on) so the whole feature can be disabled per environment.
@Injectable()
export class TfaGuard implements CanActivate {
  // A controller-scoped guard is instantiated in its host module's DI context. TfaService lives deep in the
  // KYC graph (with circular deps), so injecting it directly would force every staff-controller module to
  // import KycModule. Instead we depend only on ModuleRef (available everywhere) and resolve the TfaService
  // singleton lazily at request time.
  constructor(private readonly moduleRef: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!Config.auth.tfaStaffEnforced) return true;

    const request = context.switchToHttp().getRequest();

    const userDataId = request.user?.account;
    if (!userDataId) throw new ForbiddenException('User not authenticated');

    // live request IP (mirrors RealIP), so the check matches the IP the 2FA log was written with
    const ip = request.realIp ?? request.socket?.remoteAddress ?? 'unknown';

    const tfaService = this.moduleRef.get(TfaService, { strict: false });
    await tfaService.check(userDataId, ip, TfaLevel.STRICT);
    return true;
  }
}
