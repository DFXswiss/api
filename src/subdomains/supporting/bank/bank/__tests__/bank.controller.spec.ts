import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
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
