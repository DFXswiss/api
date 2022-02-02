import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';

@Injectable()
export class RoleGuard implements CanActivate {
  // role permission mapping
  private readonly allowedRoles = {
    [UserRole.USER]: [UserRole.USER, UserRole.VIP, UserRole.BETA, UserRole.ADMIN],
    [UserRole.VIP]: [UserRole.VIP, UserRole.ADMIN],
    [UserRole.BETA]: [UserRole.BETA, UserRole.ADMIN],
    [UserRole.ADMIN]: [UserRole.ADMIN],

    [UserRole.MASTERNODE_OPERATOR]: [UserRole.MASTERNODE_OPERATOR],
  };

  constructor(private readonly entryRole: UserRole) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return this.allowedRoles[this.entryRole].includes(request.user.role);
  }
}
