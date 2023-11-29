import { Test, TestingModule } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import { HttpService } from 'src/shared/services/http.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomLnurlpLRequest } from '../../dto/__mocks__/lnurlp.dto.mock';
import { createCustomLnurlwRequest } from '../../dto/__mocks__/lnurlw.dto.mock';
import { LightningService } from '../../services/lightning.service';
import { LnUrlForwardService } from '../../services/lnurl-forward.service';
import { LnUrlPForwardController } from '../lnurlp-forward.controller';
import { LnUrlWForwardController } from '../lnurlw-forward.controller';

describe('LnurlForward', () => {
  let httpServiceMock: HttpService;
  let lnurlpForward: LnUrlPForwardController;
  let lnurlwForward: LnUrlWForwardController;

  beforeAll(async () => {
    const config = {
      url: () => 'https://test.dfx.api:12345/v0.1',
      blockchain: {
        lightning: {
          lnbits: {
            lnurlpUrl: 'https://this-is-a-testserver.somewhere.com:5000/lnurlp',
            lnurlpApiUrl: 'https://this-is-a-testserver.somewhere.com:5000/lnurlp/api/v1',
            lnurlwApiUrl: 'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1',
          },
        },
      },
    };

    httpServiceMock = mock<HttpService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [],
      providers: [
        TestUtil.provideConfig(config),
        { provide: HttpService, useValue: httpServiceMock },
        LightningService,
        LnUrlForwardService,
      ],
      controllers: [LnUrlPForwardController, LnUrlWForwardController],
    }).compile();

    lnurlpForward = module.get<LnUrlPForwardController>(LnUrlPForwardController);
    lnurlwForward = module.get<LnUrlWForwardController>(LnUrlWForwardController);
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
    jest.spyOn(httpServiceMock, 'get').mockImplementation(async (url, _config) => {
      expect(url).toEqual('https://this-is-a-testserver.somewhere.com:5000/lnurlp/api/v1/lnurl/cb/ABC123');

      return { pr: 'This is the test invoice' };
    });

    const result = await lnurlpForward.lnUrlPCallbackForward('ABC123', {});

    expect(result).toEqual({ pr: 'This is the test invoice' });
  });

  describe('LNURLw', () => {
    it('lnurlwForward', async () => {
      jest.spyOn(httpServiceMock, 'get').mockImplementation(async (url, _config) => {
        if (url === 'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/links/ABC123') {
          return { unique_hash: 'o4bogBuERyemG9SvuEKPpb' };
        }

        expect(url).toEqual(
          'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/lnurl/o4bogBuERyemG9SvuEKPpb',
        );

        return createCustomLnurlwRequest({
          callback: 'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/lnurl/cb/ABC123',
        });
      });

      const result = await lnurlwForward.lnUrlWForward('ABC123');

      expect(result).toEqual(
        createCustomLnurlwRequest({
          callback: 'https://test.dfx.api:12345/v0.1/lnurlw/cb/ABC123',
        }),
      );
    });

    it('lnurlwCallbackForward', async () => {
      jest.spyOn(httpServiceMock, 'get').mockImplementation(async (url, _config) => {
        if (url === 'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/links/ABC123') {
          return { unique_hash: 'o4bogBuERyemG9SvuEKPpb' };
        }

        expect(url).toEqual(
          'https://this-is-a-testserver.somewhere.com:5000/withdraw/api/v1/lnurl/cb/o4bogBuERyemG9SvuEKPpb',
        );

        return { status: 'OK' };
      });

      const result = await lnurlwForward.lnUrlWCallbackForward('ABC123', {});

      expect(result).toEqual({ status: 'OK' });
    });
  });
});
