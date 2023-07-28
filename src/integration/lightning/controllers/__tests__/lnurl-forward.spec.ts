import { mock } from 'jest-mock-extended';
import { HttpService } from 'src/shared/services/http.service';
import { createCustomLnurlpLRequest } from '../../dto/__mocks__/lnurlp.dto.mock';
import { createCustomLnurlwRequest } from '../../dto/__mocks__/lnurlw.dto.mock';
import { LightningService } from '../../services/lightning.service';
import { LnUrlForwardService } from '../../services/lnurl-forward.service';
import { LnUrlPForwardController } from '../lnurlp-forward.controller';
import { LnUrlWForwardController } from '../lnurlw-forward.controller';

jest.mock('src/config/config', () => ({
  Config: {
    url: 'https://test.dfx.api:12345/v0.1',
    blockchain: {
      lightning: {
        lnbits: {
          lnurlpUrl: 'https://this-is-a-testserver.somewhere.com:5000/lnurlp',
          lnurlpApiUrl: 'https://this-is-a-testserver.somewhere.com:5000/lnurlp/api/v1',
          lnurlwApiUrl: 'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1',
        },
      },
    },
  },
}));

describe('LnurlForward', () => {
  let httpServiceMock: HttpService;
  let lnurlpForward: LnUrlPForwardController;
  let lnurlwForward: LnUrlWForwardController;

  beforeAll(() => {
    httpServiceMock = mock<HttpService>();

    const lightningService = new LightningService(httpServiceMock);
    const lnUrlForwardService = new LnUrlForwardService(lightningService);

    lnurlpForward = new LnUrlPForwardController(lnUrlForwardService);
    lnurlwForward = new LnUrlWForwardController(lnUrlForwardService);
  });

  describe('LNURLp', () => {
    it('lnurlpForward', async () => {
      jest.spyOn(httpServiceMock, 'get').mockResolvedValue(
        createCustomLnurlpLRequest({
          callback: 'https://this-is-a-testserver.somewhere.com:5000/lnurlp/cb/ABC123',
        }),
      );

      const result = await lnurlpForward.lnUrlPForward('ABC123');

      expect(result).toEqual(
        createCustomLnurlpLRequest({
          callback: 'https://test.dfx.api:12345/v0.1/lnurlp/cb/ABC123',
        }),
      );
    });
  });

  it('lnurlpCallbackForward', async () => {
    jest.spyOn(httpServiceMock, 'get').mockImplementation((url, _config) => {
      expect(url).toEqual('https://this-is-a-testserver.somewhere.com:5000/lnurlp/api/v1/lnurl/cb/ABC123');

      return Promise.resolve({ pr: 'This is the test invoice' });
    });

    const result = await lnurlpForward.lnUrlPCallbackForward('ABC123', {});

    expect(result).toEqual({ pr: 'This is the test invoice' });
  });

  describe('LNURLw', () => {
    it('lnurlwForward', async () => {
      jest.spyOn(httpServiceMock, 'get').mockImplementation((url, _config) => {
        if (url === 'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/links/ABC123') {
          return Promise.resolve({ unique_hash: 'o4bogBuERyemG9SvuEKPpb' });
        }

        expect(url).toEqual(
          'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/lnurl/o4bogBuERyemG9SvuEKPpb',
        );

        return Promise.resolve(
          createCustomLnurlwRequest({
            callback: 'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/lnurl/cb/ABC123',
          }),
        );
      });

      const result = await lnurlwForward.lnUrlWForward('ABC123');

      expect(result).toEqual(
        createCustomLnurlwRequest({
          callback: 'https://test.dfx.api:12345/v0.1/lnurlw/cb/ABC123',
        }),
      );
    });

    it('lnurlwCallbackForward', async () => {
      jest.spyOn(httpServiceMock, 'get').mockImplementation((url, _config) => {
        if (url === 'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/links/ABC123') {
          return Promise.resolve({ unique_hash: 'o4bogBuERyemG9SvuEKPpb' });
        }

        expect(url).toEqual(
          'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/lnurl/cb/o4bogBuERyemG9SvuEKPpb',
        );

        return Promise.resolve({ status: 'OK' });
      });

      const result = await lnurlwForward.lnUrlWCallbackForward('ABC123', {});

      expect(result).toEqual({ status: 'OK' });
    });
  });
});
