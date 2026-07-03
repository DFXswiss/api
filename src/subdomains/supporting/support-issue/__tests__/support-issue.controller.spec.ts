import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ModuleRef } from '@nestjs/core';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { CreateSupportMessageDto } from '../dto/create-support-message.dto';
import { SupportEscalationService } from '../services/support-escalation.service';
import { SupportIssueService } from '../services/support-issue.service';
import { SupportIssueController } from '../support-issue.controller';

// SupportIssueController imports TfaGuard on its staff routes, which transitively pulls in the kyc entity
// graph; that graph has a circular import that resolves to `undefined` when this spec is loaded in isolation.
// The guard is never exercised here (the controller is unit-constructed), so stub the service module — same
// approach as tfa.guard.spec.
jest.mock('src/subdomains/generic/kyc/services/tfa.service', () => ({
  TfaLevel: { BASIC: 'Basic', STRICT: 'Strict' },
  TfaService: class TfaService {},
}));

// createSupportMessage decides whether a message is a staff reply (createMessageSupport) or a customer
// message (createMessage). Super admin must count as staff — before this change it fell through to createMessage.
describe('SupportIssueController.createSupportMessage routing', () => {
  let controller: SupportIssueController;
  let service: DeepMocked<SupportIssueService>;
  let tfaService: { check: jest.Mock };
  let moduleRef: DeepMocked<ModuleRef>;

  const dto = {} as CreateSupportMessageDto;
  const ip = '1.2.3.4';

  beforeEach(() => {
    service = createMock<SupportIssueService>();
    tfaService = { check: jest.fn() };
    moduleRef = createMock<ModuleRef>();
    moduleRef.get.mockReturnValue(tfaService);
    controller = new SupportIssueController(service, createMock<SupportEscalationService>(), moduleRef);
  });

  describe.each([UserRole.SUPPORT, UserRole.COMPLIANCE, UserRole.ADMIN, UserRole.SUPER_ADMIN])(
    'staff role %s',
    (role) => {
      it('routes the message to createMessageSupport', async () => {
        await controller.createSupportMessage({ role, account: 7 } as JwtPayload, '42', dto, ip);

        expect(service.createMessageSupport).toHaveBeenCalledWith(42, dto);
        expect(service.createMessage).not.toHaveBeenCalled();
      });
    },
  );

  it('routes a regular user message to createMessage', async () => {
    await controller.createSupportMessage({ role: UserRole.USER, account: 7 } as JwtPayload, '42', dto, ip);

    expect(service.createMessage).toHaveBeenCalledWith('42', dto, 7);
    expect(service.createMessageSupport).not.toHaveBeenCalled();
  });

  it('routes an unauthenticated message to createMessage', async () => {
    await controller.createSupportMessage(undefined, '42', dto, ip);

    expect(service.createMessage).toHaveBeenCalledWith('42', dto, undefined);
    expect(service.createMessageSupport).not.toHaveBeenCalled();
  });

  // The JWT role stays valid until the token expires (default 2d), but the account may be
  // blocked in the meantime. Staff routing must additionally check `isUserActive(jwt)` so a
  // blocked staff account cannot keep posting official replies. Pins the fallthrough
  // behaviour introduced by #4033 item 1.
  describe('blocked staff fallthrough to createMessage', () => {
    it.each([
      ['userStatus BLOCKED', { userStatus: 'Blocked' as const }],
      ['userStatus DELETED', { userStatus: 'Deleted' as const }],
      ['accountStatus BLOCKED', { accountStatus: 'Blocked' as const }],
      ['accountStatus DEACTIVATED', { accountStatus: 'Deactivated' as const }],
      ['riskStatus BLOCKED', { riskStatus: 'Blocked' as const }],
      ['riskStatus SUSPICIOUS', { riskStatus: 'Suspicious' as const }],
    ])('routes to createMessage when a staff JWT has %s', async (_label, block) => {
      const jwt = { role: UserRole.SUPPORT, account: 7, ...block } as unknown as JwtPayload;

      await controller.createSupportMessage(jwt, '42', dto, ip);

      expect(service.createMessage).toHaveBeenCalledWith('42', dto, 7);
      expect(service.createMessageSupport).not.toHaveBeenCalled();
    });

    it('routes an active staff JWT (all statuses ACTIVE) to createMessageSupport', async () => {
      const jwt = {
        role: UserRole.SUPPORT,
        account: 7,
        userStatus: 'Active',
        accountStatus: 'Active',
      } as unknown as JwtPayload;

      await controller.createSupportMessage(jwt, '42', dto, ip);

      expect(service.createMessageSupport).toHaveBeenCalledWith(42, dto);
      expect(service.createMessage).not.toHaveBeenCalled();
    });
  });

  // A mail-elevated staff token (tfaRequired) must pass STRICT 2FA before an official reply is dispatched,
  // mirroring the TfaGuard on the dedicated staff routes. Wallet-signature staff sessions are unaffected.
  describe('2FA enforcement on mail-origin staff sessions', () => {
    it('enforces STRICT 2FA before dispatching the staff reply', async () => {
      const jwt = { role: UserRole.COMPLIANCE, account: 7, tfaRequired: true } as JwtPayload;

      await controller.createSupportMessage(jwt, '42', dto, ip);

      expect(tfaService.check).toHaveBeenCalledWith(7, ip, 'Strict');
      expect(service.createMessageSupport).toHaveBeenCalledWith(42, dto);
    });

    it('blocks the staff reply when 2FA verification fails', async () => {
      const jwt = { role: UserRole.COMPLIANCE, account: 7, tfaRequired: true } as JwtPayload;
      tfaService.check.mockRejectedValue(new Error('TFA required (strict)'));

      await expect(controller.createSupportMessage(jwt, '42', dto, ip)).rejects.toThrow('TFA required (strict)');
      expect(service.createMessageSupport).not.toHaveBeenCalled();
    });

    it('skips 2FA for a wallet-login staff session (no tfaRequired marker)', async () => {
      await controller.createSupportMessage({ role: UserRole.SUPPORT, account: 7 } as JwtPayload, '42', dto, ip);

      expect(tfaService.check).not.toHaveBeenCalled();
      expect(service.createMessageSupport).toHaveBeenCalledWith(42, dto);
    });
  });
});
