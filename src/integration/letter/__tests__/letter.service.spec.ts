import { createMock } from '@golevelup/ts-jest';
import { HttpService } from 'src/shared/services/http.service';
import { LetterService } from '../letter.service';

jest.mock('src/config/config', () => ({
  Config: { letter: { url: 'https://letter.example.com', auth: { username: 'user', apikey: 'key' } } },
}));

describe('LetterService.getBalance', () => {
  let http: HttpService;
  let service: LetterService;

  beforeEach(() => {
    http = createMock<HttpService>();
    service = new LetterService(http);
  });

  it('probes the balance with retries and a bounded timeout', async () => {
    jest.spyOn(http, 'post').mockResolvedValue({ balance: { value: '7.5' } } as never);

    await expect(service.getBalance()).resolves.toBe(7.5);
    expect(http.post).toHaveBeenCalledWith(
      expect.stringContaining('/getBalance'),
      { auth: expect.anything() },
      expect.objectContaining({ timeout: 10000, tryCount: 3, retryDelay: 1000 }),
    );
  });
});
