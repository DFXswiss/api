import { CanActivate, ExecutionContext } from '@nestjs/common';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';

class JwtUserActiveGuardClass implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isAuthenticated = await new OptionalJwtAuthGuard().canActivate(context);
    if (!isAuthenticated) return false;

    const hasRole = await RoleGuard(UserRole.USER).canActivate(context);
    if (!hasRole) return false;

    return UserActiveGuard().canActivate(context);
  }
}

export function JwtUserActiveGuard(): JwtUserActiveGuardClass {
  return new JwtUserActiveGuardClass();
}
