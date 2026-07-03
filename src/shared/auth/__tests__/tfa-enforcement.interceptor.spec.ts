import { createMock } from '@golevelup/ts-jest';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { TfaRequiredException } from 'src/subdomains/generic/kyc/exceptions/tfa-required.exception';
import { TfaLevel, TfaService } from 'src/subdomains/generic/kyc/services/tfa.service';
import { TfaEnforcementInterceptor } from '../tfa-enforcement.interceptor';

// tfa.service transitively imports the kyc entity graph, which is circular at import time and breaks when
// this isolated unit test is the first to load it. The interceptor only needs the service's shape and the
// TfaLevel enum, so the module is replaced at runtime; the real types are still used for type-checking.
jest.mock('src/subdomains/generic/kyc/services/tfa.service', () => ({
  TfaLevel: { BASIC: 'Basic', STRICT: 'Strict' },
  TfaService: class TfaService {},
}));

describe('TfaEnforcementInterceptor', () => {
  let interceptor: TfaEnforcementInterceptor;
  let tfaService: TfaService;
  let moduleRef: ModuleRef;
  let reflector: Reflector;
  let next: CallHandler;
  let handle: jest.Mock;

  const context = (request: any): ExecutionContext =>
    createMock<ExecutionContext>({ switchToHttp: () => ({ getRequest: () => request }) as any });

  beforeEach(() => {
    tfaService = createMock<TfaService>();
    moduleRef = createMock<ModuleRef>();
    reflector = createMock<Reflector>();
    jest.spyOn(moduleRef, 'get').mockReturnValue(tfaService);

    handle = jest.fn().mockReturnValue(of('handled'));
    next = { handle } as CallHandler;

    interceptor = new TfaEnforcementInterceptor(moduleRef, reflector);
  });

  it('enforces STRICT 2FA for a mail-origin staff token (tfaRequired, live request ip) and continues on success', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jest.spyOn(tfaService, 'check').mockResolvedValue(undefined);

    await interceptor.intercept(context({ user: { account: 7, tfaRequired: true }, realIp: '1.2.3.4' }), next);

    expect(moduleRef.get).toHaveBeenCalledWith(TfaService, { strict: false });
    expect(tfaService.check).toHaveBeenCalledWith(7, '1.2.3.4', TfaLevel.STRICT);
    expect(handle).toHaveBeenCalled();
  });

  it('propagates TfaRequiredException and does not continue when 2FA is missing', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jest.spyOn(tfaService, 'check').mockRejectedValue(new TfaRequiredException(TfaLevel.STRICT));

    await expect(
      interceptor.intercept(context({ user: { account: 7, tfaRequired: true }, realIp: '1.2.3.4' }), next),
    ).rejects.toBeInstanceOf(TfaRequiredException);
    expect(handle).not.toHaveBeenCalled();
  });

  it('skips enforcement on an @AllowTfaPending endpoint so a tfaRequired token can complete 2FA', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    await interceptor.intercept(context({ user: { account: 7, tfaRequired: true }, realIp: '1.2.3.4' }), next);

    expect(handle).toHaveBeenCalled();
    expect(tfaService.check).not.toHaveBeenCalled();
    expect(moduleRef.get).not.toHaveBeenCalled();
  });

  it('fast-path: passes through without touching Reflector/TfaService when tfaRequired is absent', async () => {
    await interceptor.intercept(context({ user: { account: 1, role: 'Support' } }), next);

    expect(handle).toHaveBeenCalled();
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
    expect(moduleRef.get).not.toHaveBeenCalled();
    expect(tfaService.check).not.toHaveBeenCalled();
  });

  it('fast-path: passes through a public route without request.user', async () => {
    await interceptor.intercept(context({}), next);

    expect(handle).toHaveBeenCalled();
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
    expect(moduleRef.get).not.toHaveBeenCalled();
  });
});
