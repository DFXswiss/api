import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Like } from 'typeorm';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import {
  CreateSupportIssueTemplateDto,
  SupportIssueTemplateDto,
  SupportIssueTemplateListQuery,
  UpdateSupportIssueTemplateDto,
} from '../dto/support-issue-template.dto';
import { SupportIssueTemplate } from '../entities/support-issue-template.entity';
import { SupportIssueTemplateRepository } from '../repositories/support-issue-template.repository';

const SEARCH_LIMIT = 500;

@Injectable()
export class SupportIssueTemplateService {
  constructor(
    private readonly templateRepo: SupportIssueTemplateRepository,
    private readonly userDataService: UserDataService,
  ) {}

  async search(query: SupportIssueTemplateListQuery): Promise<SupportIssueTemplate[]> {
    const search = query.search?.trim();
    const findOptions = { order: { name: 'ASC' as const }, take: SEARCH_LIMIT };

    if (!search) return this.templateRepo.find(findOptions);

    const pattern = `%${search}%`;
    return this.templateRepo.find({
      where: [{ name: Like(pattern) }, { content: Like(pattern) }, { contentEn: Like(pattern) }],
      ...findOptions,
    });
  }

  async create(jwtAccount: number, dto: CreateSupportIssueTemplateDto): Promise<SupportIssueTemplate> {
    const author = await this.userDataService.getUserData(jwtAccount);
    if (!author) throw new ForbiddenException('Author user data not found');

    return this.templateRepo.save(
      this.templateRepo.create({
        name: dto.name,
        content: dto.contents.de,
        contentEn: dto.contents.en,
        authorId: jwtAccount,
        authorMail: author.mail ?? `userData#${jwtAccount}`,
      }),
    );
  }

  async update(
    id: number,
    role: UserRole,
    jwtAccount: number,
    dto: UpdateSupportIssueTemplateDto,
  ): Promise<SupportIssueTemplate> {
    const template = await this.templateRepo.findOneBy({ id });
    if (!template) throw new NotFoundException('Template not found');

    if (!this.canModify(template, role, jwtAccount)) {
      throw new ForbiddenException('Only the author or an admin can edit this template');
    }

    if (dto.name != null) template.name = dto.name;

    if (dto.contents) {
      if (dto.contents.de != null) template.content = dto.contents.de;
      if (dto.contents.en !== undefined) template.contentEn = dto.contents.en || undefined;
    }

    return this.templateRepo.save(template);
  }

  async delete(id: number, role: UserRole, jwtAccount: number): Promise<void> {
    const template = await this.templateRepo.findOneBy({ id });
    if (!template) throw new NotFoundException('Template not found');

    if (!this.canModify(template, role, jwtAccount)) {
      throw new ForbiddenException('Only the author or an admin can delete this template');
    }

    await this.templateRepo.remove(template);
  }

  toDto(template: SupportIssueTemplate, role: UserRole, jwtAccount: number): SupportIssueTemplateDto {
    return {
      id: template.id,
      name: template.name,
      contents: {
        de: template.content,
        en: template.contentEn || undefined,
      },
      authorMail: template.authorMail,
      isOwn: template.authorId === jwtAccount,
      isAdmin: role === UserRole.ADMIN,
      created: template.created,
      updated: template.updated,
    };
  }

  private canModify(template: SupportIssueTemplate, role: UserRole, jwtAccount: number): boolean {
    if (role === UserRole.ADMIN) return true;
    return template.authorId === jwtAccount;
  }
}
