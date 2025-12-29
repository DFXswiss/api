import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
import { AuthCacheDto, AuthLnUrlService } from '../auth-lnurl.service';
import { AuthResponseDto } from '../dto/auth-response.dto';

describe('LnurlAuth', () => {
  let lnUrlAuthService: AuthLnUrlService;
  let authServiceMock: AuthService;
  let ipLogServiceMock: IpLogService;

  let signupDto: AuthLnurlSignupDto;

  const maxLoop = 10;
  const k1Array: string[] = [];

  const login = async (signupDto) =>
    lnUrlAuthService.login(Object.assign(new AuthLnurlSignupDto(), { ...signupDto }), '127.0.0.0');
  const status = (k1) => lnUrlAuthService.status(k1);

  let internalAuthCache: Map<string, AuthCacheDto>;

  beforeAll(async () => {
    const config = {
      url: () => 'https://test.dfx.api:12345/v0.1',
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
    internalAuthCache = (lnUrlAuthService as any).authCache;
  });

  beforeEach(() => {
    const ipLog = new IpLog();
    ipLog.result = true;
    jest.spyOn(ipLogServiceMock, 'create').mockResolvedValue(ipLog);

    signupDto = createSignupDto();

    createLoginLnurl(lnUrlAuthService, maxLoop, k1Array);
    expect(k1Array.length).toStrictEqual(maxLoop);
  });

  afterEach(() => {
    internalAuthCache.clear();

    k1Array.splice(0, k1Array.length);
  });

  describe('Auth', () => {
    it('checks authCache containing maxloop entries', async () => {
      expect(internalAuthCache.size).toStrictEqual(maxLoop);

      const internalAuthCacheKeys = [...internalAuthCache.keys()];
      expect(internalAuthCacheKeys.length).toStrictEqual(maxLoop);

      internalAuthCacheKeys.forEach((k) => {
        const authCacheEntry = internalAuthCache.get(k);
        expect(authCacheEntry.k1).toStrictEqual(k);
        expect(authCacheEntry.k1CreationTime).toBeDefined();
        expect(authCacheEntry.accessToken).toBeUndefined();
        expect(authCacheEntry.accessTokenCreationTime).toBeUndefined();
      });
    });

    it('should remove entries from authCache with creation time before 5 minutes', async () => {
      const keys = [...internalAuthCache.keys()];

      const authCacheEntry0 = internalAuthCache.get(keys[0]);
      const authCacheEntry5 = internalAuthCache.get(keys[5]);

      const before6MinTime = Util.minutesBefore(6).getTime();

      authCacheEntry0.k1CreationTime = before6MinTime;
      authCacheEntry5.k1CreationTime = before6MinTime;

      expect(internalAuthCache.size).toStrictEqual(maxLoop);

      lnUrlAuthService.processCleanupAuthCache();

      expect(internalAuthCache.size).toStrictEqual(maxLoop - 2);
      expect(internalAuthCache.get(keys[0])).toBeUndefined();
      expect(internalAuthCache.get(keys[5])).toBeUndefined();
    });

    it('should cleanup entries from authCache with access token creation time before 30 seconds', async () => {
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

      expect(internalAuthCache.size).toStrictEqual(maxLoop);

      lnUrlAuthService.processCleanupAccessToken();

      expect(internalAuthCache.size).toStrictEqual(maxLoop - 3);
      expect(internalAuthCache.get(keys[1])).toBeUndefined();
      expect(internalAuthCache.get(keys[6])).toBeUndefined();
      expect(internalAuthCache.get(keys[9])).toBeUndefined();

      expect(internalAuthCache.get(keys[0]).accessToken).toStrictEqual('BF120');
      expect(internalAuthCache.get(keys[0]).accessTokenCreationTime).toBeDefined();
      expect(internalAuthCache.get(keys[2]).accessToken).toStrictEqual('CD345');
      expect(internalAuthCache.get(keys[2]).accessTokenCreationTime).toBeDefined();
    });

    it('should throw an exception if ip address is not allowed', async () => {
      const ipLog = new IpLog();
      ipLog.result = false;
      jest.spyOn(ipLogServiceMock, 'create').mockResolvedValue(Promise.resolve(ipLog));

      const testCall = async () => lnUrlAuthService.login(signupDto, '127.0.0.0');

      insertCache(internalAuthCache, signupDto.k1);
      expect(internalAuthCache.size).toStrictEqual(maxLoop + 1);

      await expect(testCall).rejects.toThrow(ForbiddenException);
      expect(internalAuthCache.size).toStrictEqual(maxLoop);

      insertCache(internalAuthCache, signupDto.k1);
      expect(internalAuthCache.size).toStrictEqual(maxLoop + 1);
      await expect(testCall).rejects.toThrowError('The country of IP address is not allowed');
      expect(internalAuthCache.size).toStrictEqual(maxLoop);
    });

    it('should return an error if there is no tag found', async () => {
      insertCache(internalAuthCache, signupDto.k1);
      expect(internalAuthCache.size).toStrictEqual(maxLoop + 1);

      signupDto.tag = undefined;
      await expect(login(signupDto)).resolves.toStrictEqual({ status: 'ERROR', reason: 'invalid tag' });

      signupDto.tag = 'x';
      await expect(login(signupDto)).resolves.toStrictEqual({ status: 'ERROR', reason: 'invalid tag' });

      expect(internalAuthCache.size).toStrictEqual(maxLoop);
    });

    it('should return an error if there is no action found', async () => {
      signupDto.action = undefined;
      await expect(login(signupDto)).resolves.toStrictEqual({ status: 'ERROR', reason: 'invalid action' });

      signupDto.action = 'x';
      await expect(login(signupDto)).resolves.toStrictEqual({ status: 'ERROR', reason: 'invalid action' });
    });

    it('should return an error if there is an unknown challenge given', async () => {
      await expect(login(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'invalid challenge',
      });
    });

    it('should return an error if challenge is expired', async () => {
      insertCache(internalAuthCache, signupDto.k1, Util.minutesBefore(6).getTime());

      await expect(login(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'challenge expired',
      });
    });

    it('should return an error if this is an invalid auth signature', async () => {
      signupDto.k1 = 'e2af6254a8df433264fa23f67eb8188635d15ce883e8fc020989d5f82ae6f11f';
      insertCache(internalAuthCache, signupDto.k1);

      await expect(login(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'invalid auth signature',
      });
    });

    it('should return an error if this is an invalid auth signature', async () => {
      signupDto.sig =
        '304402203767faf494f110b139293d9bab3c50e07b3bf33c463d4aa767256cd09132dc5102205821f8efacdb5c595b92ada255876d9201e126e2f31a140d44561cc1f7e9e43e';
      insertCache(internalAuthCache, signupDto.k1);

      await expect(login(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'invalid auth signature',
      });
    });

    it('should return an error if this is an invalid auth signature', async () => {
      signupDto.key = '02c3b844b8104f0c1b15c507774c9ba7fc609f58f343b9b149122e944dd20c9363';
      insertCache(internalAuthCache, signupDto.k1);

      await expect(login(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'invalid auth signature',
      });
    });

    it('should return an error while providing an internal signIn exception', async () => {
      jest.spyOn(authServiceMock, 'signIn').mockRejectedValue(new ConflictException('User already exists'));

      insertCache(internalAuthCache, signupDto.k1);

      await expect(login(signupDto)).resolves.toStrictEqual({
        status: 'ERROR',
        reason: 'User already exists',
      });
    });

    it('should create an access token and return ok', async () => {
      const authResponse = new AuthResponseDto();
      authResponse.accessToken = 'HelloWorldAccessToken';
      jest.spyOn(authServiceMock, 'signIn').mockResolvedValue(Promise.resolve(authResponse));

      insertCache(internalAuthCache, signupDto.k1);

      await expect(login(signupDto)).resolves.toStrictEqual({ status: 'OK' });

      const authCacheEntry = internalAuthCache.get(signupDto.k1);
      expect(authCacheEntry.accessToken).toStrictEqual('HelloWorldAccessToken');
    });

    it('should throw an exception while not cached', async () => {
      const testCall = async (k1) => lnUrlAuthService.status(k1);

      await expect(testCall(signupDto.k1)).rejects.toThrow(NotFoundException);
      await expect(testCall(signupDto.k1)).rejects.toThrowError('k1 not found');
    });

    it('should return an empty access token while not available', async () => {
      insertCache(internalAuthCache, signupDto.k1);

      expect(status(signupDto.k1).isComplete).toStrictEqual(false);
      expect(status(signupDto.k1).accessToken).toBeUndefined();
    });

    it('should return an access token', async () => {
      const authResponse = new AuthResponseDto();
      authResponse.accessToken = 'HelloOtherWorldAccessToken';
      jest.spyOn(authServiceMock, 'signIn').mockResolvedValue(Promise.resolve(authResponse));

      insertCache(internalAuthCache, signupDto.k1);

      expect(internalAuthCache.size).toStrictEqual(maxLoop + 1);

      await expect(login(signupDto)).resolves.toStrictEqual({ status: 'OK' });

      const statusResponse = status(signupDto.k1);

      expect(internalAuthCache.size).toStrictEqual(maxLoop);

      expect(statusResponse.isComplete).toStrictEqual(true);
      expect(statusResponse.accessToken).toStrictEqual('HelloOtherWorldAccessToken');
    });
  });
});

function insertCache(internalAuthCache: Map<string, AuthCacheDto>, k1: string, creationTime = Date.now()) {
  internalAuthCache.set(k1, {
    servicesIp: '127.0.0.1',
    servicesUrl: Config.url(),
    k1: k1,
    k1CreationTime: creationTime,
  });
}

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
    const createLoginResponse = lnUrlAuthService.create('127.0.0.1', Config.url());
    const authUrl = new URL(LightningHelper.decodeLnurl(createLoginResponse.lnurl));
    const urlParams = authUrl.searchParams;

    const k1 = urlParams.get('k1');
    if (k1) k1Array.push(k1);

    expect(authUrl.protocol).toStrictEqual('https:');
    expect(authUrl.hostname).toStrictEqual('test.dfx.api');
    expect(authUrl.port).toStrictEqual('12345');
    expect(authUrl.pathname).toStrictEqual('/v0.1/lnurla');
    expect(urlParams.get('tag')).toStrictEqual('login');
    expect(urlParams.get('action')).toStrictEqual('login');
  }
}
