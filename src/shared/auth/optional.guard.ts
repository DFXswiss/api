import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // Override handleRequest so it never throws an error
  handleRequest(err: any, user: any, info: any, context: any) {
    return user;
  }
}
