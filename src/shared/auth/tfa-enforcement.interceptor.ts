import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { AllowTfaPendingKey } from 'src/shared/auth/allow-tfa-pending.decorator';
import { TfaLevel, TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';

// Global backstop for the "mail-origin staff ⇒ STRICT app-2FA" invariant. A staff role reached via the weaker
// mail-magic-link factor carries request.user.tfaRequired (stamped when the token is minted, see
// AuthService.generateUserToken); such a session must complete STRICT app/TOTP 2FA before it may touch ANY
// route. Enforcing this per-route via TfaGuard is easy to forget on optional-auth branches and service-layer
// role checks (that gap was #4031/#4036) — this interceptor closes it in ONE place so it cannot be forgotten.
//
// - Registered as an APP_INTERCEPTOR: interceptors run AFTER guards, so request.user is already populated here
//   (a guard would run before AuthGuard and see no user).
// - FAST PATH: any request without a tfaRequired token — wallet-signature staff (never stamped) and all
//   non-staff traffic — returns on a single property read, with zero Reflector/DB/ModuleRef overhead. This is
//   critical: the interceptor is global and must be a no-op for essentially all traffic.
// - Endpoints marked @AllowTfaPending (the 2FA-completion endpoints) are skipped, otherwise a tfaRequired
//   token could never reach the flow that clears its marker.
// - TfaService is resolved lazily via ModuleRef (mirrors TfaGuard) so AppModule need not import KycModule,
//   which would create a module-import cycle.
// - With this global backstop in place the per-route TfaGuard decorators are now redundant and can be retired
//   in a follow-up; they are kept here belt-and-suspenders to keep this change minimal.
@Injectable()
export class TfaEnforcementInterceptor implements NestInterceptor {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();

    // FAST PATH: only mail-origin staff sessions (tfaRequired) are gated; this single property read
    // short-circuits all other traffic before any Reflector/DB/ModuleRef work runs.
    if (!request.user?.tfaRequired) return next.handle();

    // The 2FA-completion endpoints must stay reachable so a tfaRequired token can actually clear its marker.
    const allowPending = this.reflector.getAllAndOverride<boolean>(AllowTfaPendingKey, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowPending) return next.handle();

    // Mirror TfaGuard: a tfaRequired token is always minted with an account, but guard against a malformed one.
    if (!request.user.account) throw new ForbiddenException('User not authenticated');

    // live request IP (mirrors RealIP), so the check matches the IP the 2FA log was written with
    const ip = request.realIp ?? request.socket?.remoteAddress ?? 'unknown';

    // Throws TfaRequiredException (403, code TFA_REQUIRED) when no valid STRICT app-2FA log exists; the staff
    // frontend already routes that code through the 2FA flow. request.user.account is the userDataId.
    const tfaService = this.moduleRef.get(TfaService, { strict: false });
    await tfaService.check(request.user.account, ip, TfaLevel.STRICT);

    return next.handle();
  }
}
