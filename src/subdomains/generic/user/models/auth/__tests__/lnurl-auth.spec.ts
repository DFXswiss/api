import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import { Config } from 'src/config/config';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { IpLog } from 'src/shared/models/ip-log/ip-log.entity';
import { IpLogService } from 'src/shared/models/ip-log/ip-log.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { AuthService } from 'src/subdomains/generic/user/models/auth/auth.service';
import { AuthLnurlSignupDto } from 'src/subdomains/generic/user/models/auth/dto/auth-lnurl.dto';
import { AuthResponseDto } from 'src/subdomains/generic/user/models/auth/dto/auth-response.dto';
import { AuthCacheDto, AuthLnUrlService } from '../auth-lnurl.service';

describe('LnurlAuth', () => {
  let lnUrlAuthService: AuthLnUrlService;
  let authServiceMock: AuthService;
  let ipLogServiceMock: IpLogService;

  let signupDto: Partial<AuthLnurlSignupDto>;

  const maxLoop = 10;
  const k1Array: string[] = [];

  const checkSignature = async (signupDto) =>
    lnUrlAuthService.checkSignature('127.0.0.1', Config.url, Object.assign(new AuthLnurlSignupDto(), { ...signupDto }));

  const getStatus = (signature, k1, key) => lnUrlAuthService.getStatus(signature, k1, key);

  beforeAll(async () => {
    const config = {
      url: 'https://test.dfx.api:12345/v0.1',
      processDisabled: () => false,
    };

    authServiceMock = mock<AuthService>();
    ipLogServiceMock = mock<IpLogService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [],
      providers: [
        TestUtil.provideConfig(config),
        { provide: AuthService, useValue: authServiceMock },
        { provide: IpLogService, useValue: ipLogServiceMock },
        AuthLnUrlService,
      ],
      controllers: [],
    }).compile();

    lnUrlAuthService = module.get<AuthLnUrlService>(AuthLnUrlService);
  });

  beforeEach(() => {
    const ipLog = new IpLog();
    ipLog.result = true;
    jest.spyOn(ipLogServiceMock, 'create').mockResolvedValue(Promise.resolve(ipLog));

    signupDto = createSignupDto();

    createLoginLnurl(lnUrlAuthService, maxLoop, k1Array);
    expect(k1Array.length).toEqual(maxLoop);
  });

  afterEach(() => {
    const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
    internalAuthCache.clear();

    k1Array.splice(0, k1Array.length);
  });

  describe('Auth', () => {
    it('checks authCache containing maxloop entries', async () => {
      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      expect(internalAuthCache.size).toEqual(maxLoop);

      const internalAuthCacheKeys = [...internalAuthCache.keys()];
      expect(internalAuthCacheKeys.length).toEqual(maxLoop);

      internalAuthCacheKeys.forEach((k) => {
        const authCacheEntry = internalAuthCache.get(k);
        expect(authCacheEntry.k1).toEqual(k);
        expect(authCacheEntry.k1CreationTime).toBeDefined();
        expect(authCacheEntry.accessToken).toBeUndefined();
        expect(authCacheEntry.accessTokenCreationTime).toBeUndefined();
      });
    });

    it('should remove entries from authCache with creation time before 5 minutes', async () => {
      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      const keys = [...internalAuthCache.keys()];

      const authCacheEntry0 = internalAuthCache.get(keys[0]);
      const authCacheEntry5 = internalAuthCache.get(keys[5]);

      const before6MinTime = Util.minutesBefore(6).getTime();

      authCacheEntry0.k1CreationTime = before6MinTime;
      authCacheEntry5.k1CreationTime = before6MinTime;

      expect(internalAuthCache.size).toEqual(maxLoop);

      lnUrlAuthService.processCleanupAuthCache();

      expect(internalAuthCache.size).toEqual(maxLoop - 2);
      expect(internalAuthCache.get(keys[0])).toBeUndefined();
      expect(internalAuthCache.get(keys[5])).toBeUndefined();
    });

    it('should cleanup entries from authCache with access token creation time before 30 seconds', async () => {
      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      const keys = [...internalAuthCache.keys()];

      const authCacheEntry0 = internalAuthCache.get(keys[0]);
      const authCacheEntry2 = internalAuthCache.get(keys[2]);

      authCacheEntry0.accessToken = 'BF120';
      authCacheEntry0.accessTokenCreationTime = Date.now();
      authCacheEntry2.accessToken = 'CD345';
      authCacheEntry2.accessTokenCreationTime = Date.now();

      const authCacheEntry1 = internalAuthCache.get(keys[1]);
      const authCacheEntry6 = internalAuthCache.get(keys[6]);
      const authCacheEntry9 = internalAuthCache.get(keys[9]);

      authCacheEntry1.accessToken = 'AB123';
      authCacheEntry1.accessTokenCreationTime = Util.secondsBefore(31).getTime();
      authCacheEntry6.accessToken = 'XY890';
      authCacheEntry6.accessTokenCreationTime = Util.secondsBefore(32).getTime();
      authCacheEntry9.accessToken = 'VW567';
      authCacheEntry9.accessTokenCreationTime = Util.secondsBefore(33).getTime();

      expect(internalAuthCache.size).toEqual(maxLoop);

      lnUrlAuthService.processCleanupAccessToken();

      expect(internalAuthCache.size).toEqual(maxLoop);

      expect(internalAuthCache.get(keys[0]).accessToken).toEqual('BF120');
      expect(internalAuthCache.get(keys[0]).accessTokenCreationTime).toBeDefined();
      expect(internalAuthCache.get(keys[2]).accessToken).toEqual('CD345');
      expect(internalAuthCache.get(keys[2]).accessTokenCreationTime).toBeDefined();

      expect(internalAuthCache.get(keys[1]).accessToken).toBeUndefined();
      expect(internalAuthCache.get(keys[1]).accessTokenCreationTime).toBeUndefined();
      expect(internalAuthCache.get(keys[6]).accessToken).toBeUndefined();
      expect(internalAuthCache.get(keys[6]).accessTokenCreationTime).toBeUndefined();
      expect(internalAuthCache.get(keys[9]).accessToken).toBeUndefined();
      expect(internalAuthCache.get(keys[9]).accessTokenCreationTime).toBeUndefined();
    });

    it('should throw an exception if ip address is not allowed', async () => {
      const ipLog = new IpLog();
      ipLog.result = false;
      jest.spyOn(ipLogServiceMock, 'create').mockResolvedValue(Promise.resolve(ipLog));

      const testCall = async () => lnUrlAuthService.checkSignature('127.0.0.1', Config.url, new AuthLnurlSignupDto());

      await expect(testCall).rejects.toThrow(ForbiddenException);
      await expect(testCall).rejects.toThrowError('The country of IP address is not allowed');
    });

    it('should return an error if there is no tag found', async () => {
      signupDto.tag = undefined;
      await expect(checkSignature(signupDto)).resolves.toStrictEqual({ status: 'ERROR', reason: 'tag not found' });

      signupDto.tag = 'x';
      await expect(checkSignature(signupDto)).resolves.toStrictEqual({ status: 'ERROR', reason: 'tag not found' });
    });

    it('should return an error if there is no action found', async () => {
      signupDto.action = undefined;
      await expect(checkSignature(signupDto)).resolves.toStrictEqual({ status: 'ERROR', reason: 'action not found' });

      signupDto.action = 'x';
      await expect(checkSignature(signupDto)).resolves.toStrictEqual({ status: 'ERROR', reason: 'action not found' });
    });

    it('should return an error if there is no challenge found', async () => {
      signupDto.k1 = undefined;

      await expect(checkSignature(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'challenge not found',
      });
    });

    it('should return an error if there is no auth signature found', async () => {
      signupDto.sig = undefined;

      await expect(checkSignature(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'auth signature not found',
      });
    });

    it('should return an error if there is no key found', async () => {
      signupDto.key = undefined;

      await expect(checkSignature(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'key not found',
      });
    });

    it('should return an error if there is an unknown challenge given', async () => {
      await expect(checkSignature(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'challenge invalid',
      });
    });

    it('should return an error if challenge is expired', async () => {
      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      internalAuthCache.set(signupDto.k1, { k1: signupDto.k1, k1CreationTime: Util.minutesBefore(6).getTime() });

      await expect(checkSignature(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'challenge expired',
      });
    });

    it('should return an error if this is an invalid auth signature', async () => {
      signupDto.k1 = 'e2af6254a8df433264fa23f67eb8188635d15ce883e8fc020989d5f82ae6f11f';

      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      internalAuthCache.set(signupDto.k1, { k1: signupDto.k1, k1CreationTime: Date.now() });

      await expect(checkSignature(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'invalid auth signature',
      });
    });

    it('should return an error if this is an invalid auth signature', async () => {
      signupDto.sig =
        '304402203767faf494f110b139293d9bab3c50e07b3bf33c463d4aa767256cd09132dc5102205821f8efacdb5c595b92ada255876d9201e126e2f31a140d44561cc1f7e9e43e';

      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      internalAuthCache.set(signupDto.k1, { k1: signupDto.k1, k1CreationTime: Date.now() });

      await expect(checkSignature(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'invalid auth signature',
      });
    });

    it('should return an error if this is an invalid auth signature', async () => {
      signupDto.key = '02c3b844b8104f0c1b15c507774c9ba7fc609f58f343b9b149122e944dd20c9363';

      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      internalAuthCache.set(signupDto.k1, { k1: signupDto.k1, k1CreationTime: Date.now() });

      await expect(checkSignature(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'invalid auth signature',
      });
    });

    it('should create an access token and return ok', async () => {
      const authResponse = new AuthResponseDto();
      authResponse.accessToken = 'HelloWorldAccessToken';
      jest.spyOn(authServiceMock, 'signIn').mockResolvedValue(Promise.resolve(authResponse));

      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      internalAuthCache.set(signupDto.k1, { k1: signupDto.k1, k1CreationTime: Date.now() });

      await expect(checkSignature(signupDto)).resolves.toStrictEqual({ status: 'OK' });

      const authCacheEntry = internalAuthCache.get(signupDto.k1);
      expect(authCacheEntry.accessToken).toEqual('HelloWorldAccessToken');
    });

    it('returns an empty access token while not cached', async () => {
      expect(getStatus(signupDto.sig, signupDto.k1, signupDto.key)).toStrictEqual('');
    });

    it('returns an empty access token while not verified', async () => {
      signupDto.sig =
        '304402203767faf494f110b139293d9bab3c50e07b3bf33c463d4aa767256cd09132dc5102205821f8efacdb5c595b92ada255876d9201e126e2f31a140d44561cc1f7e9e43e';

      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      internalAuthCache.set(signupDto.k1, { k1: signupDto.k1, k1CreationTime: Date.now() });

      expect(getStatus(signupDto.sig, signupDto.k1, signupDto.key)).toStrictEqual('');
    });

    it('returns an empty access token while not available', async () => {
      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      internalAuthCache.set(signupDto.k1, { k1: signupDto.k1, k1CreationTime: Date.now() });

      expect(getStatus(signupDto.sig, signupDto.k1, signupDto.key)).toStrictEqual('');
    });

    it('returns an access token', async () => {
      const authResponse = new AuthResponseDto();
      authResponse.accessToken = 'HelloOtherWorldAccessToken';
      jest.spyOn(authServiceMock, 'signIn').mockResolvedValue(Promise.resolve(authResponse));

      const internalAuthCache = (lnUrlAuthService as any).authCache as Map<string, AuthCacheDto>;
      internalAuthCache.set(signupDto.k1, { k1: signupDto.k1, k1CreationTime: Date.now() });

      await expect(checkSignature(signupDto)).resolves.toStrictEqual({ status: 'OK' });

      expect(getStatus(signupDto.sig, signupDto.k1, signupDto.key)).toStrictEqual('HelloOtherWorldAccessToken');
    });
  });
});

function createSignupDto(): AuthLnurlSignupDto {
  return Object.assign(new AuthLnurlSignupDto(), {
    tag: 'login',
    action: 'login',
    k1: 'e2af6254a8df433264fa23f67eb8188635d15ce883e8fc020989d5f82ae6f11e',
    sig: '304402203767faf494f110b139293d9bab3c50e07b3bf33c463d4aa767256cd09132dc5102205821f8efacdb5c595b92ada255876d9201e126e2f31a140d44561cc1f7e9e43d',
    key: '02c3b844b8104f0c1b15c507774c9ba7fc609f58f343b9b149122e944dd20c9362',
    address: '1234567890',
    signature: 'abcdefedcba',
  });
}

function createLoginLnurl(lnUrlAuthService: AuthLnUrlService, maxLoop: number, k1Array: string[]) {
  for (let loop = 0; loop < maxLoop; loop++) {
    const authLnurl = lnUrlAuthService.createLoginLnurl();
    const authUrl = new URL(LightningHelper.decodeLnurl(authLnurl));
    const urlParams = authUrl.searchParams;

    const k1 = urlParams.get('k1');
    if (k1) k1Array.push(k1);

    expect(authUrl.protocol).toEqual('https:');
    expect(authUrl.hostname).toEqual('test.dfx.api');
    expect(authUrl.port).toEqual('12345');
    expect(authUrl.pathname).toEqual('/v0.1/lnurla');
    expect(urlParams.get('tag')).toEqual('login');
    expect(urlParams.get('action')).toEqual('login');
  }
}
