import { createMock } from '@golevelup/ts-jest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
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

  beforeEach(() => {
    tfaService = createMock<TfaService>();
    moduleRef = createMock<ModuleRef>();
    jest.spyOn(moduleRef, 'get').mockReturnValue(tfaService);
    guard = new TfaGuard(moduleRef);
  });

  it('passes through a wallet-login staff token (no tfaRequired) without checking 2FA', async () => {
    await expect(guard.canActivate(context({ user: { account: 1, role: 'Support' } }))).resolves.toBe(true);
    expect(tfaService.check).not.toHaveBeenCalled();
  });

  it('enforces STRICT 2FA for a mail-origin staff token (tfaRequired, live request ip)', async () => {
    jest.spyOn(tfaService, 'check').mockResolvedValue(undefined);

    await expect(
      guard.canActivate(context({ user: { account: 7, tfaRequired: true }, realIp: '1.2.3.4' })),
    ).resolves.toBe(true);
    expect(tfaService.check).toHaveBeenCalledWith(7, '1.2.3.4', TfaLevel.STRICT);
  });

  it('propagates TfaRequiredException when 2FA is missing for a mail-origin token', async () => {
    jest.spyOn(tfaService, 'check').mockRejectedValue(new TfaRequiredException(TfaLevel.STRICT));

    await expect(
      guard.canActivate(context({ user: { account: 7, tfaRequired: true }, realIp: '1.2.3.4' })),
    ).rejects.toBeInstanceOf(TfaRequiredException);
  });

  it('forbids a mail-origin token without an account', async () => {
    await expect(guard.canActivate(context({ user: { tfaRequired: true, role: 'X' } }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tfaService.check).not.toHaveBeenCalled();
  });

  it('falls back from realIp to socket.remoteAddress', async () => {
    jest.spyOn(tfaService, 'check').mockResolvedValue(undefined);

    await guard.canActivate(context({ user: { account: 7, tfaRequired: true }, socket: { remoteAddress: '9.9.9.9' } }));
    expect(tfaService.check).toHaveBeenCalledWith(7, '9.9.9.9', TfaLevel.STRICT);
  });
});
