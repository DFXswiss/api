import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { UserRole } from 'src/user/user.entity';

@Injectable()
export class RoleGuard implements CanActivate {
  entryRole: UserRole;

  constructor(role: UserRole) {
    this.entryRole = role;
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
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
          userRole === UserRole.VIP
        ) {
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
      default:
        return false;
    }
  }
}
