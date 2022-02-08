import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';

@Injectable()
export class RoleGuard implements CanActivate {
  // additional allowed roles
  private readonly additionalRoles = {
    [UserRole.USER]: [UserRole.VIP, UserRole.BETA, UserRole.ADMIN],
    [UserRole.VIP]: [UserRole.ADMIN],
    [UserRole.BETA]: [UserRole.ADMIN],
  };

  constructor(private readonly entryRole: UserRole) {}

  canActivate(context: ExecutionContext): boolean {
    const userRole = context.switchToHttp().getRequest().user.role;
    return this.entryRole === userRole || this.additionalRoles[this.entryRole]?.includes(userRole);
  }
}
