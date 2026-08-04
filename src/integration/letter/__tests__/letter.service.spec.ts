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

describe('LetterService.sendLetter', () => {
  let http: HttpService;
  let service: LetterService;

  const dto = { data: 'cGRm', page: 1, color: '4', mode: 'simplex', ship: 'national' } as never;

  beforeEach(() => {
    http = createMock<HttpService>();
    service = new LetterService(http);
  });

  it('confirms a dispatch the provider accepted', async () => {
    jest.spyOn(http, 'post').mockResolvedValue({ status: 200, letter: { job_id: 'j1' } } as never);

    await expect(service.sendLetter(dto)).resolves.toBe(true);
  });

  it('reports a refusal the provider actually stated', async () => {
    jest.spyOn(http, 'post').mockResolvedValue({ status: 400, message: 'invalid pdf' } as never);

    await expect(service.sendLetter(dto)).resolves.toBe(false);
  });

  it.each([
    ['an empty body', {}],
    ['no body at all', undefined],
    ['a status that is not a number', { status: 'queued' }],
  ])('refuses to call %s a refusal', async (_case, body) => {
    jest.spyOn(http, 'post').mockResolvedValue(body as never);

    // `false` is read by callers as proof that nothing was sent. An unrecognised response does not say
    // that - the job may well exist - and calling it a refusal would invite a second physical letter.
    await expect(service.sendLetter(dto)).rejects.toThrow('Unexpected letter provider response');
  });
});
