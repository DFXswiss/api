import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { hasRoleAccess } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';

// Global strip of the login credential on `User.signature` for non-admin HTTP responses.
//
// At least 13 endpoints surface this column today through relations; `Transaction.user` is eager and
// carries it even when no user relation was requested. Filtering per endpoint would be incomplete and
// would be forgotten on every new admin read path — this interceptor closes the leak in ONE place.
//
// Filtering is by entity type (`instanceof User`), never by property name: other entities in the repo
// also carry a field named `signature` (e.g. RealUnit registrations) and must not be stripped.
// Missing `request.user` is treated as non-admin (fail-closed), not as a special pass-through.
// A WeakSet tracks visited objects so cyclic entity graphs (bidirectional relations) do not loop.
//
// Registered as an APP_INTERCEPTOR next to TfaEnforcementInterceptor.
@Injectable()
export class SignatureVisibilityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const role: UserRole | undefined = request.user?.role;

    // FAST PATH: ADMIN / SUPER_ADMIN traffic keeps the full response; no map, no walk.
    // This is the bulk of admin-endpoint traffic and must stay a single role check.
    if (hasRoleAccess(UserRole.ADMIN, role)) return next.handle();

    return next.handle().pipe(map((data) => this.stripSignatures(data)));
  }

  private stripSignatures(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (typeof value !== 'object' || value === null) return value;
    if (value instanceof Date) return value;
    if (value instanceof Buffer) return value;
    if (seen.has(value as object)) return value;

    seen.add(value as object);

    if (Array.isArray(value)) {
      for (const element of value) {
        this.stripSignatures(element, seen);
      }
      return value;
    }

    if (value instanceof User) {
      delete (value as { signature?: string }).signature;
    }

    for (const key of Object.keys(value as object)) {
      this.stripSignatures((value as Record<string, unknown>)[key], seen);
    }

    return value;
  }
}
