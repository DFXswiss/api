import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { TfaLevel, TfaService } from '../services/tfa.service';

// Enforces a valid 2FA verification on staff endpoints, so a staff role obtained via the weaker
// mail-magic-link factor (or any login) is only usable as a true second factor (TfaLevel.STRICT).
// Place AFTER AuthGuard/RoleGuard so request.user is populated. Reuses the existing TfaService;
// throws TfaRequiredException (403, code TFA_REQUIRED) which the staff frontend already handles.
// Gated by Config.auth.tfaStaffEnforced so it can be rolled out per environment once the frontend
// drives the 2FA setup/verify flow for staff.
@Injectable()
export class TfaGuard implements CanActivate {
  constructor(private readonly tfaService: TfaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!Config.auth.tfaStaffEnforced) return true;

    const request = context.switchToHttp().getRequest();

    const userDataId = request.user?.account;
    if (!userDataId) throw new ForbiddenException('User not authenticated');

    // live request IP (mirrors RealIP), so the check matches the IP the 2FA log was written with
    const ip = request.realIp ?? request.socket?.remoteAddress ?? 'unknown';

    await this.tfaService.check(userDataId, ip, TfaLevel.STRICT);
    return true;
  }
}
