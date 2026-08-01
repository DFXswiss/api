import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { ClientErrorController } from '../client-error.controller';
import { ClientErrorService } from '../client-error.service';
import { CreateClientErrorDto } from '../dto/create-client-error.dto';

// This endpoint is deliberately unauthenticated, so the rate limit is the only thing standing
// between a public route and unbounded log writes. That wiring is worth pinning.
describe('ClientErrorController', () => {
  let controller: ClientErrorController;
  let service: DeepMocked<ClientErrorService>;

  const dto: CreateClientErrorDto = Object.assign(new CreateClientErrorDto(), { message: 'boom' });

  beforeEach(() => {
    service = createMock<ClientErrorService>();
    controller = new ClientErrorController(service);
  });

  it('passes the reported error and the request context to the service', () => {
    controller.logError(dto, 'dfx-services', 'Mozilla/5.0');

    expect(service.logError).toHaveBeenCalledWith(dto, 'dfx-services', 'Mozilla/5.0');
  });

  it('accepts a report without client or user agent', () => {
    controller.logError(dto);

    expect(service.logError).toHaveBeenCalledWith(dto, undefined, undefined);
  });

  // --- ROUTING & SECURITY METADATA --- //

  const handler = ClientErrorController.prototype.logError;

  it('is mounted as POST log/clientError', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ClientErrorController)).toBe('log/clientError');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });

  it('guards the route with RateLimitGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RateLimitGuard]);
  });

  it('carries a route-level throttle, which is what gives the guard a limit at all', () => {
    // RateLimitGuard resolves `routeOrClassLimit || this.options.limit`, and ThrottlerModule.forRoot()
    // is registered without options - so without this decorator nothing would be throttled.
    expect(Reflect.getMetadata(THROTTLER_LIMIT, handler)).toBe(20);
    expect(Reflect.getMetadata(THROTTLER_TTL, handler)).toBe(60);
  });
});
