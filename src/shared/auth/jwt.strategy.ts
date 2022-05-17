import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-custom';
import { GetConfig } from 'src/config/config';
import { UserRepository } from 'src/user/models/user/user.repository';
import { JwtPayload } from './jwt-payload.interface';
import { UserRole } from './user-role.enum';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly jwtService: JwtService, private userRepo: UserRepository) {
    super();
  }

  async validate(request: Request): Promise<any> {
    const token = request.headers.authorization.replace('Bearer ', '');
    const payload: JwtPayload = this.jwtService.decode(token) as JwtPayload;

    const user = await this.userRepo.findOne(payload?.id);
    if (!payload?.id || !user || user.address !== payload.address) throw new UnauthorizedException();

    if (![UserRole.USER, UserRole.BETA, UserRole.VIP].includes(payload.role)) {
      await this.jwtService.verifyAsync(token, { secret: GetConfig().auth.jwt.secret }).catch(() => {
        throw new UnauthorizedException();
      });
    }

    return payload;
  }
}
