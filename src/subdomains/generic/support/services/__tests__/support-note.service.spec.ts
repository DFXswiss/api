import { ForbiddenException } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Department } from 'src/subdomains/supporting/support-issue/enums/department.enum';
import { FindOperator } from 'typeorm';
import { UserData } from '../../../user/models/user-data/user-data.entity';
import { UserDataService } from '../../../user/models/user-data/user-data.service';
import { SupportNote } from '../../entities/support-note.entity';
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

    const buildQb = (): Record<string, jest.Mock> => {
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

    const hasDepartmentFilter = (): boolean => andWhereClauses.some((c) => c.includes('note.department IN'));

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

// The note write/admin paths key off ADMIN_ROLES, which now also includes SUPER_ADMIN. Before this change a
// super admin threw on note creation and could only touch its own notes; these pin the new admin-superset behaviour.
describe('SupportNoteService admin-role write access', () => {
  let service: SupportNoteService;
  let noteRepo: DeepMocked<SupportNoteRepository>;
  let userDataService: DeepMocked<UserDataService>;

  // a note authored by account 1; the acting admin below is the unrelated account 99
  const foreignNote = (): SupportNote =>
    Object.assign(new SupportNote(), {
      id: 5,
      authorId: 1,
      department: Department.SUPPORT,
      subject: 'old',
      content: 'old',
    });

  beforeEach(() => {
    noteRepo = createMock<SupportNoteRepository>();
    userDataService = createMock<UserDataService>();
    service = new SupportNoteService(noteRepo, userDataService);
  });

  describe.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])('%s', (role) => {
    it('creates a note in the explicitly requested department', async () => {
      userDataService.getUserData.mockResolvedValue(Object.assign(new UserData(), { id: 99, mail: 'a@dfx.swiss' }));
      (noteRepo.create as jest.Mock).mockImplementation((e) => e);
      (noteRepo.save as jest.Mock).mockImplementation((e) => Promise.resolve(e));

      const note = await service.create(role, 99, { department: Department.COMPLIANCE, content: 'c' });

      expect(note.department).toBe(Department.COMPLIANCE);
      expect(noteRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ department: Department.COMPLIANCE, authorId: 99 }),
      );
    });

    it('rejects note creation without a department', async () => {
      await expect(service.create(role, 99, { content: 'c' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(noteRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a department that may not be assigned to a note', async () => {
      await expect(
        service.create(role, 99, { department: Department.COOPERATION, content: 'c' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(noteRepo.save).not.toHaveBeenCalled();
    });

    it('can edit a note authored by someone else', async () => {
      noteRepo.findOne.mockResolvedValue(foreignNote());
      (noteRepo.save as jest.Mock).mockImplementation((e) => Promise.resolve(e));

      const updated = await service.update(5, role, 99, { content: 'new', subject: 'new' });

      expect(updated.content).toBe('new');
      expect(noteRepo.save).toHaveBeenCalled();
    });

    it('can delete a note authored by someone else', async () => {
      const note = foreignNote();
      noteRepo.findOneBy.mockResolvedValue(note);

      await service.delete(5, role, 99);

      expect(noteRepo.remove).toHaveBeenCalledWith(note);
    });

    it('flags the note as admin in the dto', () => {
      expect(service.toDto(foreignNote(), role, 99).isAdmin).toBe(true);
    });
  });

  it('still forbids a non-author, non-admin role from editing a foreign note', async () => {
    noteRepo.findOne.mockResolvedValue(foreignNote());
    await expect(service.update(5, UserRole.SUPPORT, 99, { content: 'new' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(noteRepo.save).not.toHaveBeenCalled();
  });
});
