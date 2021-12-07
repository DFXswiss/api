import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { UserRole } from 'src/shared/auth/user-role.enum';

@Injectable()
export class RoleGuard implements CanActivate {
  entryRole: UserRole;

  constructor(role: UserRole) {
    this.entryRole = role;
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();

    if (request.user.role === UserRole.ADMIN) {
      return true;
    }

    if (this.hasPermission(request.user.role, this.entryRole)) {
      return true;
    }

    return false;
  }

  hasPermission(userRole: UserRole, entryRole: UserRole): boolean {
    switch (entryRole) {
      case UserRole.USER:
        if (
          userRole === UserRole.USER ||
          userRole === UserRole.EMPLOYEE ||
          userRole === UserRole.VIP ||
          userRole === UserRole.BETA
        ) {
          return true;
        } else {
          return false;
        }
      case UserRole.BETA:
        if (userRole === UserRole.EMPLOYEE || userRole === UserRole.BETA) {
          return true;
        } else {
          return false;
        }
      case UserRole.VIP:
        if (userRole === UserRole.VIP || userRole === UserRole.EMPLOYEE) {
          return true;
        } else {
          return false;
        }
      case UserRole.EMPLOYEE:
        if (userRole === UserRole.EMPLOYEE) {
          return true;
        } else {
          return false;
        }
      case UserRole.SUPPORT:
        if (userRole === UserRole.SUPPORT) {
          return true;
        } else {
          return false;
        }
      default:
        return false;
    }
  }
}
