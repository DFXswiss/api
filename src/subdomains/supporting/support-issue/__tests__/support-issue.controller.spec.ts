import { createMock, DeepMocked } from '@golevelup/ts-jest';
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

  const dto = {} as CreateSupportMessageDto;

  beforeEach(() => {
    service = createMock<SupportIssueService>();
    controller = new SupportIssueController(service, createMock<SupportEscalationService>());
  });

  describe.each([UserRole.SUPPORT, UserRole.COMPLIANCE, UserRole.ADMIN, UserRole.SUPER_ADMIN])(
    'staff role %s',
    (role) => {
      it('routes the message to createMessageSupport', async () => {
        await controller.createSupportMessage({ role, account: 7 } as JwtPayload, '42', dto);

        expect(service.createMessageSupport).toHaveBeenCalledWith(42, dto);
        expect(service.createMessage).not.toHaveBeenCalled();
      });
    },
  );

  it('routes a regular user message to createMessage', async () => {
    await controller.createSupportMessage({ role: UserRole.USER, account: 7 } as JwtPayload, '42', dto);

    expect(service.createMessage).toHaveBeenCalledWith('42', dto, 7);
    expect(service.createMessageSupport).not.toHaveBeenCalled();
  });

  it('routes an unauthenticated message to createMessage', async () => {
    await controller.createSupportMessage(undefined, '42', dto);

    expect(service.createMessage).toHaveBeenCalledWith('42', dto, undefined);
    expect(service.createMessageSupport).not.toHaveBeenCalled();
  });
});
