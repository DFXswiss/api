import { createMock } from '@golevelup/ts-jest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Config, ConfigService, Configuration } from 'src/config/config';
import { TfaRequiredException } from '../../exceptions/tfa-required.exception';
import { TfaLevel, TfaService } from '../../services/tfa.service';
import { TfaGuard } from '../tfa.guard';

// tfa.service transitively imports the kyc entity graph, which is circular at import time and breaks
// when this isolated unit test is the first to load it. The guard only needs the service's shape and
// the TfaLevel enum, so the module is replaced at runtime; the real types are still used for type-checking.
jest.mock('../../services/tfa.service', () => ({
  TfaLevel: { BASIC: 'Basic', STRICT: 'Strict' },
  TfaService: class TfaService {},
}));

describe('TfaGuard', () => {
  let guard: TfaGuard;
  let tfaService: TfaService;
  let moduleRef: ModuleRef;

  const context = (request: any): ExecutionContext =>
    createMock<ExecutionContext>({ switchToHttp: () => ({ getRequest: () => request }) as any });

  beforeAll(() => {
    new ConfigService(new Configuration()); // initializes the static Config the guard reads
  });

  beforeEach(() => {
    tfaService = createMock<TfaService>();
    moduleRef = createMock<ModuleRef>();
    jest.spyOn(moduleRef, 'get').mockReturnValue(tfaService);
    guard = new TfaGuard(moduleRef);
    Object.assign(Config.auth, { tfaStaffEnforced: true });
  });

  afterEach(() => {
    Object.assign(Config.auth, { tfaStaffEnforced: false });
  });

  it('passes through without checking 2FA when the feature flag is off', async () => {
    Object.assign(Config.auth, { tfaStaffEnforced: false });

    await expect(guard.canActivate(context({ user: { account: 1 } }))).resolves.toBe(true);
    expect(tfaService.check).not.toHaveBeenCalled();
  });

  it('allows the request when 2FA is verified (STRICT, live request ip)', async () => {
    jest.spyOn(tfaService, 'check').mockResolvedValue(undefined);

    await expect(guard.canActivate(context({ user: { account: 7 }, realIp: '1.2.3.4' }))).resolves.toBe(true);
    expect(tfaService.check).toHaveBeenCalledWith(7, '1.2.3.4', TfaLevel.STRICT);
  });

  it('propagates TfaRequiredException when 2FA is missing', async () => {
    jest.spyOn(tfaService, 'check').mockRejectedValue(new TfaRequiredException(TfaLevel.STRICT));

    await expect(guard.canActivate(context({ user: { account: 7 }, realIp: '1.2.3.4' }))).rejects.toBeInstanceOf(
      TfaRequiredException,
    );
  });

  it('forbids a token without an account (e.g. company token)', async () => {
    await expect(guard.canActivate(context({ user: { role: 'X' } }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(tfaService.check).not.toHaveBeenCalled();
  });

  it('falls back from realIp to socket.remoteAddress', async () => {
    jest.spyOn(tfaService, 'check').mockResolvedValue(undefined);

    await guard.canActivate(context({ user: { account: 7 }, socket: { remoteAddress: '9.9.9.9' } }));
    expect(tfaService.check).toHaveBeenCalledWith(7, '9.9.9.9', TfaLevel.STRICT);
  });
});
