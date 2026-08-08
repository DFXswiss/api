import { createMock } from '@golevelup/ts-jest';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { firstValueFrom, Observable, of } from 'rxjs';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { SignatureVisibilityInterceptor } from '../signature-visibility.interceptor';

// Self-referencing shape for the cycle case - the interceptor must terminate on it.
interface Cyclic {
  ref?: Cyclic;
}

describe('SignatureVisibilityInterceptor', () => {
  let interceptor: SignatureVisibilityInterceptor;
  let next: CallHandler;
  let handle: jest.Mock;

  const context = (request: unknown): ExecutionContext =>
    createMock<ExecutionContext>({ switchToHttp: () => ({ getRequest: () => request }) as never });

  // The interceptor is typed against `unknown` payloads, so each case states the shape it put in.
  const run = async <T>(request: unknown): Promise<T> =>
    firstValueFrom((await interceptor.intercept(context(request), next)) as Observable<T>);

  beforeEach(() => {
    handle = jest.fn();
    next = { handle } as CallHandler;
    interceptor = new SignatureVisibilityInterceptor();
  });

  it('passes a User entity through unchanged when the caller role is ADMIN (fast path)', async () => {
    const user = Object.assign(new User(), { id: 1, signature: 'secret-sig', address: 'addr-1' });
    handle.mockReturnValue(of(user));

    const result = await run<User>({ user: { role: UserRole.ADMIN } });

    expect(handle).toHaveBeenCalled();
    expect(result).toBe(user);
    expect(result.signature).toBe('secret-sig');
  });

  it('passes a User entity through unchanged when the caller role is SUPER_ADMIN', async () => {
    const user = Object.assign(new User(), { id: 2, signature: 'secret-sig', address: 'addr-2' });
    handle.mockReturnValue(of(user));

    const result = await run<User>({ user: { role: UserRole.SUPER_ADMIN } });

    expect(handle).toHaveBeenCalled();
    expect(result).toBe(user);
    expect(result.signature).toBe('secret-sig');
  });

  it('strips signature from a User entity when the caller role is SUPPORT, keeping other properties', async () => {
    const user = Object.assign(new User(), { id: 3, signature: 'secret-sig', address: 'addr-3' });
    handle.mockReturnValue(of(user));

    const result = await run<User>({ user: { role: UserRole.SUPPORT } });

    expect(result.signature).toBeUndefined();
    expect(result.address).toBe('addr-3');
  });

  it('strips signature from a User entity when there is no request.user (unauthenticated)', async () => {
    const user = Object.assign(new User(), { id: 4, signature: 'secret-sig', address: 'addr-4' });
    handle.mockReturnValue(of(user));

    const result = await run<User>({});

    expect(result.signature).toBeUndefined();
    expect(result.address).toBe('addr-4');
  });

  it('recursively strips signature from nested User entities (userData.users[])', async () => {
    const userA = Object.assign(new User(), { id: 10, signature: 'sig-a' });
    const userB = Object.assign(new User(), { id: 11, signature: 'sig-b' });
    const payload = { userData: { users: [userA, userB] } };
    handle.mockReturnValue(of(payload));

    const result = await run<{ userData: { users: User[] } }>({ user: { role: UserRole.SUPPORT } });

    expect(result.userData.users[0].signature).toBeUndefined();
    expect(result.userData.users[1].signature).toBeUndefined();
  });

  it('leaves a non-User object with its own signature property untouched (must not filter by field name)', async () => {
    // Critical case: other entities (e.g. RealUnit registrations) also carry a `signature` field and
    // must not be stripped — only `instanceof User` may trigger removal.
    const other = { id: 1, signature: 'not-a-login-credential' };
    handle.mockReturnValue(of(other));

    const result = await run<{ signature: string }>({ user: { role: UserRole.SUPPORT } });

    expect(result.signature).toBe('not-a-login-credential');
  });

  it('does not loop infinitely on a cyclic object graph', async () => {
    const a: Cyclic = {};
    const b: Cyclic = { ref: a };
    a.ref = b;
    handle.mockReturnValue(of(a));

    const result = await run<Cyclic>({ user: { role: UserRole.SUPPORT } });

    expect(result).toBe(a);
    expect(result.ref).toBe(b);
  });

  // The cases above exercise the interceptor directly, so none of them would notice if the global
  // registration were dropped - the protection would be silently gone. This pins the wiring itself.
  it('is registered globally as an APP_INTERCEPTOR', async () => {
    const { AppModule } = await import('src/app.module');
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) as {
      provide?: unknown;
      useClass?: unknown;
    }[];

    expect(providers.some((p) => p.provide === APP_INTERCEPTOR && p.useClass === SignatureVisibilityInterceptor)).toBe(
      true,
    );
  });
});
