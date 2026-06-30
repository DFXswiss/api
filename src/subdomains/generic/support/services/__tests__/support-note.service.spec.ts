import { createMock } from '@golevelup/ts-jest';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Department } from 'src/subdomains/supporting/support-issue/enums/department.enum';
import { FindOperator } from 'typeorm';
import { UserDataService } from '../../../user/models/user-data/user-data.service';
import { SupportNoteRepository } from '../../repositories/support-note.repository';
import { SupportNoteService } from '../support-note.service';

// Pins the consolidated department-visibility contract on the notes side: support is restricted,
// compliance is a superset, and admins / super admins are unrestricted (the super-admin fix).
describe('SupportNoteService department visibility', () => {
  let service: SupportNoteService;
  let noteRepo: SupportNoteRepository;

  beforeEach(() => {
    noteRepo = createMock<SupportNoteRepository>();
    service = new SupportNoteService(noteRepo, createMock<UserDataService>());
  });

  describe('search', () => {
    let find: jest.SpyInstance;

    beforeEach(() => {
      find = jest.spyOn(noteRepo, 'find').mockResolvedValue([]);
    });

    const departmentFilter = (): Department[] | undefined => {
      const where = find.mock.calls[0][0].where as { department?: FindOperator<Department[]> };
      return where.department?.value;
    };

    it('restricts support to its own department', async () => {
      await service.search(UserRole.SUPPORT, {});
      expect(departmentFilter()).toEqual([Department.SUPPORT]);
    });

    it('lets compliance see support and compliance notes (superset)', async () => {
      await service.search(UserRole.COMPLIANCE, {});
      expect(departmentFilter()).toEqual([Department.SUPPORT, Department.COMPLIANCE]);
    });

    it('applies no department filter for admin (unrestricted)', async () => {
      await service.search(UserRole.ADMIN, {});
      expect(departmentFilter()).toBeUndefined();
    });

    it('applies no department filter for super admin (was: saw zero notes)', async () => {
      await service.search(UserRole.SUPER_ADMIN, {});
      expect(departmentFilter()).toBeUndefined();
    });

    it('returns nothing for a role with no department access, without querying', async () => {
      const notes = await service.search(UserRole.USER, {});
      expect(notes).toEqual([]);
      expect(find).not.toHaveBeenCalled();
    });
  });

  describe('listUsers', () => {
    let andWhereClauses: string[];

    const buildQb = () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn((clause: string) => {
          andWhereClauses.push(clause);
          return qb;
        }),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      return qb;
    };

    let createQueryBuilder: jest.SpyInstance;

    beforeEach(() => {
      andWhereClauses = [];
      createQueryBuilder = jest.spyOn(noteRepo, 'createQueryBuilder').mockImplementation(() => buildQb() as never);
    });

    const hasDepartmentFilter = () => andWhereClauses.some((c) => c.includes('note.department IN'));

    it('restricts support to its own department', async () => {
      await service.listUsers(UserRole.SUPPORT);
      expect(hasDepartmentFilter()).toBe(true);
    });

    it('applies no department filter for super admin (unrestricted)', async () => {
      await service.listUsers(UserRole.SUPER_ADMIN);
      expect(hasDepartmentFilter()).toBe(false);
    });

    it('returns nothing for a role with no department access, without querying', async () => {
      const users = await service.listUsers(UserRole.USER);
      expect(users).toEqual([]);
      expect(createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
