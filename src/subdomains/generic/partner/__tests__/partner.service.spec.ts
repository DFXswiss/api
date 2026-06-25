import { createMock } from '@golevelup/ts-jest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as ConfigModule from 'src/config/config';
import { FeeService } from '../../../supporting/payment/services/fee.service';
import { UserData } from '../../user/models/user-data/user-data.entity';
import { UserDataStatus } from '../../user/models/user-data/user-data.enum';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import { User } from '../../user/models/user/user.entity';
import { UserService } from '../../user/models/user/user.service';
import { PartnerService } from '../partner.service';

const CALLER_ID = 1;
const CALLER_REF = '158-532';
const FEE_ID = 42;
const DEFAULT_REF = '000-000';

function makeUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: 10,
    usedRef: DEFAULT_REF,
    userData: makeUserData(),
    ...overrides,
  });
}

function makeUserData(overrides: Partial<UserData> = {}): UserData {
  return Object.assign(new UserData(), {
    id: 100,
    status: UserDataStatus.NA,
    individualFees: undefined,
    users: [],
    ...overrides,
  });
}

describe('PartnerService', () => {
  let service: PartnerService;
  let userService: UserService;
  let userDataService: UserDataService;
  let feeService: FeeService;

  beforeAll(() => {
    (ConfigModule as Record<string, unknown>).Config = { defaultRef: DEFAULT_REF };
  });

  beforeEach(async () => {
    userService = createMock<UserService>();
    userDataService = createMock<UserDataService>();
    feeService = createMock<FeeService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerService,
        { provide: UserService, useValue: userService },
        { provide: UserDataService, useValue: userDataService },
        { provide: FeeService, useValue: feeService },
      ],
    }).compile();

    service = module.get<PartnerService>(PartnerService);
  });

  describe('findUserByAddress', () => {
    beforeEach(() => {
      jest.spyOn(userService, 'getUser').mockResolvedValue(makeUser({ ref: CALLER_REF }));
    });

    it('returns dto when target.usedRef is defaultRef (new referee)', async () => {
      const target = makeUser({ usedRef: DEFAULT_REF });
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(target);

      const dto = await service.findUserByAddress('addr', CALLER_ID);

      expect(dto.canModify).toBe(true);
      expect(dto.usedRef).toBe(DEFAULT_REF);
    });

    it('returns dto when target.usedRef equals caller.ref (existing referee)', async () => {
      const target = makeUser({ usedRef: CALLER_REF });
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(target);

      const dto = await service.findUserByAddress('addr', CALLER_ID);

      expect(dto.canModify).toBe(true);
      expect(dto.usedRef).toBe(CALLER_REF);
    });

    it('throws ForbiddenException when target.usedRef is another partner', async () => {
      const target = makeUser({ usedRef: '999-999' });
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(target);

      await expect(service.findUserByAddress('addr', CALLER_ID)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when address has no user', async () => {
      jest.spyOn(userService, 'getUserByAddress').mockResolvedValue(undefined);

      await expect(service.findUserByAddress('addr', CALLER_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when caller has no ref', async () => {
      jest.spyOn(userService, 'getUser').mockResolvedValue(makeUser({ ref: undefined }));

      await expect(service.findUserByAddress('addr', CALLER_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('setOnboarding', () => {
    beforeEach(() => {
      jest.spyOn(userService, 'getUser').mockResolvedValue(makeUser({ ref: CALLER_REF }));
    });

    it('sets fee + status + usedRef for in-scope userData', async () => {
      const inScopeUser = makeUser({ id: 11, usedRef: DEFAULT_REF });
      const userData = makeUserData({ users: [inScopeUser] });
      jest.spyOn(userDataService, 'getUserData').mockResolvedValue(userData);

      await service.setOnboarding(userData.id, FEE_ID, CALLER_ID);

      expect(feeService.addFeeInternal).toHaveBeenCalledWith(userData, FEE_ID);
      expect(userDataService.updateUserDataInternal).toHaveBeenCalledWith(userData, {
        status: UserDataStatus.ACTIVE,
      });
      expect(userService.updateUserAdmin).toHaveBeenCalledWith(inScopeUser.id, { usedRef: CALLER_REF });
    });

    it('throws ForbiddenException when userData has out-of-scope user', async () => {
      const outOfScopeUser = makeUser({ id: 12, usedRef: '999-999' });
      const userData = makeUserData({ users: [outOfScopeUser] });
      jest.spyOn(userDataService, 'getUserData').mockResolvedValue(userData);

      await expect(service.setOnboarding(userData.id, FEE_ID, CALLER_ID)).rejects.toThrow(ForbiddenException);
      expect(feeService.addFeeInternal).not.toHaveBeenCalled();
    });

    it('skips status update when userData already Active', async () => {
      const userData = makeUserData({
        status: UserDataStatus.ACTIVE,
        users: [makeUser({ usedRef: CALLER_REF })],
      });
      jest.spyOn(userDataService, 'getUserData').mockResolvedValue(userData);

      await service.setOnboarding(userData.id, FEE_ID, CALLER_ID);

      expect(userDataService.updateUserDataInternal).not.toHaveBeenCalled();
    });

    it('only updates usedRef for users that currently have defaultRef', async () => {
      const newUser = makeUser({ id: 13, usedRef: DEFAULT_REF });
      const existingUser = makeUser({ id: 14, usedRef: CALLER_REF });
      const userData = makeUserData({ users: [newUser, existingUser] });
      jest.spyOn(userDataService, 'getUserData').mockResolvedValue(userData);

      await service.setOnboarding(userData.id, FEE_ID, CALLER_ID);

      expect(userService.updateUserAdmin).toHaveBeenCalledTimes(1);
      expect(userService.updateUserAdmin).toHaveBeenCalledWith(newUser.id, { usedRef: CALLER_REF });
    });
  });

  describe('removeFee', () => {
    beforeEach(() => {
      jest.spyOn(userService, 'getUser').mockResolvedValue(makeUser({ ref: CALLER_REF }));
    });

    it('removes fee for in-scope userData', async () => {
      const userData = makeUserData({ users: [makeUser({ usedRef: CALLER_REF })] });
      jest.spyOn(userDataService, 'getUserData').mockResolvedValue(userData);

      await service.removeFee(userData.id, FEE_ID, CALLER_ID);

      expect(userDataService.removeFee).toHaveBeenCalledWith(userData, FEE_ID);
    });

    it('throws ForbiddenException when out-of-scope', async () => {
      const userData = makeUserData({ users: [makeUser({ usedRef: '999-999' })] });
      jest.spyOn(userDataService, 'getUserData').mockResolvedValue(userData);

      await expect(service.removeFee(userData.id, FEE_ID, CALLER_ID)).rejects.toThrow(ForbiddenException);
      expect(userDataService.removeFee).not.toHaveBeenCalled();
    });
  });
});
