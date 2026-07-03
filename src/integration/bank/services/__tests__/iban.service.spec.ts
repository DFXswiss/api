import { createMock } from '@golevelup/ts-jest';
import { HttpService } from 'src/shared/services/http.service';
import { IbanService } from '../iban.service';

jest.mock('src/config/config', () => ({
  Config: { sepaTools: { auth: { username: 'user', password: 'pass' } } },
}));

describe('IbanService.getBalance', () => {
  let http: HttpService;
  let service: IbanService;

  beforeEach(() => {
    http = createMock<HttpService>();
    service = new IbanService(http);
  });

  it('probes the balance with retries and a bounded timeout', async () => {
    jest.spyOn(http, 'get').mockResolvedValue({ balance: 42 } as never);

    await expect(service.getBalance()).resolves.toBe(42);
    expect(http.get).toHaveBeenCalledWith(
      'https://rest.sepatools.eu/get_balance',
      expect.objectContaining({ timeout: 10000, tryCount: 3, retryDelay: 1000 }),
    );
  });
});
