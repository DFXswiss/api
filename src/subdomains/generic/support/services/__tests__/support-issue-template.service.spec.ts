import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { UserDataService } from '../../../user/models/user-data/user-data.service';
import { SupportIssueTemplate } from '../../entities/support-issue-template.entity';
import { SupportIssueTemplateRepository } from '../../repositories/support-issue-template.repository';
import { SupportIssueTemplateService } from '../support-issue-template.service';

// Template edit/delete and the isAdmin dto flag key off ADMIN_ROLES, which treats super admin as an admin
// superset. Before this change a super admin was not flagged admin and could only touch its own templates.
describe('SupportIssueTemplateService admin-role access', () => {
  let service: SupportIssueTemplateService;
  let templateRepo: DeepMocked<SupportIssueTemplateRepository>;

  // a template authored by account 1; the acting admin below is the unrelated account 99
  const foreignTemplate = (): SupportIssueTemplate =>
    Object.assign(new SupportIssueTemplate(), {
      id: 5,
      name: 'old',
      contentDe: 'alt',
      contentEn: null,
      authorId: 1,
      authorMail: 'author@dfx.swiss',
    });

  beforeEach(() => {
    templateRepo = createMock<SupportIssueTemplateRepository>();
    service = new SupportIssueTemplateService(templateRepo, createMock<UserDataService>());
  });

  describe.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])('%s', (role) => {
    it('can edit a template authored by someone else', async () => {
      templateRepo.findOneBy.mockResolvedValue(foreignTemplate());
      templateRepo.save.mockImplementation((e) => Promise.resolve(e as SupportIssueTemplate));

      const updated = await service.update(5, role, 99, { name: 'new' });

      expect(updated.name).toBe('new');
      expect(templateRepo.save).toHaveBeenCalled();
    });

    it('can delete a template authored by someone else', async () => {
      const template = foreignTemplate();
      templateRepo.findOneBy.mockResolvedValue(template);

      await service.delete(5, role, 99);

      expect(templateRepo.remove).toHaveBeenCalledWith(template);
    });

    it('flags the template as admin in the dto', () => {
      expect(service.toDto(foreignTemplate(), role, 99).isAdmin).toBe(true);
    });
  });

  it('lets a non-admin author edit its own template', async () => {
    templateRepo.findOneBy.mockResolvedValue(foreignTemplate());
    templateRepo.save.mockImplementation((e) => Promise.resolve(e as SupportIssueTemplate));

    const updated = await service.update(5, UserRole.SUPPORT, 1, { name: 'new' });

    expect(updated.name).toBe('new');
    expect(templateRepo.save).toHaveBeenCalled();
  });

  it('forbids a non-author, non-admin role from editing a foreign template', async () => {
    templateRepo.findOneBy.mockResolvedValue(foreignTemplate());

    await expect(service.update(5, UserRole.SUPPORT, 99, { name: 'new' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(templateRepo.save).not.toHaveBeenCalled();
  });

  it('forbids a non-author, non-admin role from deleting a foreign template', async () => {
    templateRepo.findOneBy.mockResolvedValue(foreignTemplate());

    await expect(service.delete(5, UserRole.SUPPORT, 99)).rejects.toBeInstanceOf(ForbiddenException);
    expect(templateRepo.remove).not.toHaveBeenCalled();
  });

  it('does not flag a non-admin role as admin in the dto', () => {
    expect(service.toDto(foreignTemplate(), UserRole.SUPPORT, 99).isAdmin).toBe(false);
  });
});
