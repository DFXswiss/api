import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

@Injectable()
export class UserGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();

    if (!request.headers.authorization) {
      return false;
    }

    const authHeader = request.headers.authorization.split(' ');
    const [address, signature] = Buffer.from(authHeader[1], 'base64')
      .toString('ascii')
      .split(':');
    return true;
    if (!authHeader[1]) {
      return false;
    }
  }
}
