import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { OptionalJwtAuthGuard } from 'src/shared/auth/optional.guard';
import { RateLimitGuard } from 'src/shared/auth/rate-limit.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { olkyEUR } from '../__mocks__/bank.entity.mock';
import { BankController } from '../bank.controller';
import { BankService } from '../bank.service';
import { CheckReceiveIbanDto } from '../dto/receive-iban.dto';
import { ReceiveIbanStatus } from '../dto/receive-iban.enum';

// The receive-iban check runs behind an optional guard, so the controller must forward the account of a
// present JWT and undefined otherwise - that distinction is what makes the service answer LoginRequired.
describe('BankController.checkReceiveIban', () => {
  let controller: BankController;
  let service: DeepMocked<BankService>;

  const dto: CheckReceiveIbanDto = { iban: olkyEUR.iban };

  beforeEach(() => {
    service = createMock<BankService>();
    controller = new BankController(service);
  });

  it('forwards the account of the authenticated customer and wraps the status', async () => {
    service.getReceiveIbanStatus.mockResolvedValue(ReceiveIbanStatus.DFX_IBAN);

    const result = await controller.checkReceiveIban({ account: 42, role: UserRole.USER } as JwtPayload, dto);

    expect(service.getReceiveIbanStatus).toHaveBeenCalledWith(dto.iban, 42);
    expect(result).toEqual({ status: ReceiveIbanStatus.DFX_IBAN });
  });

  it('forwards undefined without a JWT', async () => {
    service.getReceiveIbanStatus.mockResolvedValue(ReceiveIbanStatus.LOGIN_REQUIRED);

    const result = await controller.checkReceiveIban(undefined, dto);

    expect(service.getReceiveIbanStatus).toHaveBeenCalledWith(dto.iban, undefined);
    expect(result).toEqual({ status: ReceiveIbanStatus.LOGIN_REQUIRED });
  });
});

// The two tests above pass the JWT in directly, so they cannot see the decorators that decide whether a JWT
// is ever attached. Removing @UseGuards entirely leaves them green while every logged-in customer would get
// LoginRequired (req.user never set), and swapping in a hard AuthGuard() would 401 every anonymous customer.
describe('BankController.checkReceiveIban routing & security metadata', () => {
  const handler = BankController.prototype.checkReceiveIban;

  it('is mounted as PUT bank/receiveIban', () => {
    expect(Reflect.getMetadata(PATH_METADATA, BankController)).toBe('bank');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('receiveIban');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PUT);
  });

  it('guards the route with RateLimitGuard before OptionalJwtAuthGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

    // Order matters as documented on the route; the optional guard must be the auth guard, because a hard
    // AuthGuard() would reject exactly the anonymous callers this endpoint exists to serve.
    expect(guards).toEqual([RateLimitGuard, OptionalJwtAuthGuard]);
  });

  it('carries a route-level throttle, which is what gives the guard a limit at all', () => {
    // RateLimitGuard resolves `routeOrClassLimit || this.options.limit`, and ThrottlerModule.forRoot() is
    // registered without options - so without this decorator nothing would be throttled.
    expect(Reflect.getMetadata(THROTTLER_LIMIT, handler)).toBe(60);
    expect(Reflect.getMetadata(THROTTLER_TTL, handler)).toBe(60);
  });
});

// CheckReceiveIbanDto deliberately carries no @Transform. The Util transform helpers call string methods on
// the raw value - sanitizeString does value.trim() behind a bare truthiness check, trimAll does
// value?.replace(...) - and @Transform runs before @IsString, so a non-string body throws a TypeError that
// the exception filter turns into a 500 on a route reachable without a login. Transforms do sit on other
// IBAN fields, so adding one here would look like tidying up; these cases pin the boundary behaviour rather
// than the absence of a decorator.
describe('CheckReceiveIbanDto validation boundary', () => {
  // Same configuration as the global pipe in main.ts.
  const pipe = new ValidationPipe({ whitelist: true, transformOptions: { exposeUnsetFields: false } });
  const metadata = { type: 'body' as const, metatype: CheckReceiveIbanDto };

  it.each([123, [], {}, null, undefined, ''])(
    'rejects %p with a BadRequestException, never a TypeError',
    async (iban) => {
      await expect(pipe.transform({ iban }, metadata)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('passes a plain string through unchanged, leaving normalization to the service', async () => {
    await expect(pipe.transform({ iban: ' LI75-0881-1010-5923-K000E ' }, metadata)).resolves.toEqual({
      iban: ' LI75-0881-1010-5923-K000E ',
    });
  });
});
