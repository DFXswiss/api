import { UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { GetConfig } from 'src/config/config';
import { JwtPayload } from './jwt-payload.interface';
import { UserRole } from './user-role.enum';

export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      secretOrKey: GetConfig().auth.jwt.secret,
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const { address, user, account, role } = payload;

    switch (role) {
      case UserRole.ACCOUNT:
        if (!account) throw new UnauthorizedException();
        break;

      case UserRole.KYC_CLIENT_COMPANY:
      case UserRole.CLIENT_COMPANY:
        if (!address || !user) throw new UnauthorizedException();
        break;

      default:
        if (!address || !user || !account) throw new UnauthorizedException();
        break;
    }

    return payload;
  }
}
