import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Department, RoleDepartmentMap } from 'src/subdomains/supporting/support-issue/enums/department.enum';
import { UserDataService } from '../../user/models/user-data/user-data.service';
import {
  CreateSupportNoteDto,
  SupportNoteDto,
  SupportNoteListQuery,
  SupportNoteScope,
  SupportNoteUserDto,
  UpdateSupportNoteDto,
} from '../dto/support-note.dto';
import { SupportNote } from '../entities/support-note.entity';
import { SupportNoteRepository } from '../repositories/support-note.repository';

const ADMIN_DEPARTMENTS: Department[] = [Department.SUPPORT, Department.COMPLIANCE, Department.MARKETING];
const SEARCH_LIMIT = 200;

export function visibleDepartments(role: UserRole): Department[] {
  if (role === UserRole.ADMIN) return ADMIN_DEPARTMENTS;
  const dept = RoleDepartmentMap[role];
  return dept ? [dept] : [];
}

@Injectable()
export class SupportNoteService {
  constructor(
    private readonly noteRepo: SupportNoteRepository,
    private readonly userDataService: UserDataService,
  ) {}

  async getByUserDataId(userDataId: number, role: UserRole): Promise<SupportNote[]> {
    const departments = visibleDepartments(role);
    if (departments.length === 0) return [];

    return this.noteRepo
      .createQueryBuilder('note')
      .where('note.userDataId = :userDataId', { userDataId })
      .andWhere('note.department IN (:...departments)', { departments })
      .orderBy('note.created', 'DESC')
      .getMany();
  }

  async search(role: UserRole, query: SupportNoteListQuery): Promise<SupportNote[]> {
    const departments = visibleDepartments(role);
    if (departments.length === 0) return [];

    const qb = this.noteRepo
      .createQueryBuilder('note')
      .leftJoinAndSelect('note.userData', 'userData')
      .where('note.department IN (:...departments)', { departments });

    const scope = query.scope ?? SupportNoteScope.ALL;
    if (scope === SupportNoteScope.FREE) {
      qb.andWhere('note.userDataId IS NULL');
    } else if (scope === SupportNoteScope.BOUND) {
      qb.andWhere('note.userDataId IS NOT NULL');
    }

    if (query.userDataId != null) {
      qb.andWhere('note.userDataId = :uid', { uid: query.userDataId });
    }

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        '(note.subject LIKE :s OR note.content LIKE :s OR userData.firstname LIKE :s OR userData.surname LIKE :s OR userData.organizationName LIKE :s)',
        { s: `%${search}%` },
      );
    }

    return qb.orderBy('note.created', 'DESC').limit(SEARCH_LIMIT).getMany();
  }

  async listUsers(role: UserRole): Promise<SupportNoteUserDto[]> {
    const departments = visibleDepartments(role);
    if (departments.length === 0) return [];

    const rows: Array<{
      userDataId: number;
      firstname?: string;
      surname?: string;
      organizationName?: string;
      count: string;
    }> = await this.noteRepo
      .createQueryBuilder('note')
      .innerJoin('note.userData', 'userData')
      .select('note.userDataId', 'userDataId')
      .addSelect('userData.firstname', 'firstname')
      .addSelect('userData.surname', 'surname')
      .addSelect('userData.organizationName', 'organizationName')
      .addSelect('COUNT(note.id)', 'count')
      .where('note.department IN (:...departments)', { departments })
      .andWhere('note.userDataId IS NOT NULL')
      .groupBy('note.userDataId')
      .addGroupBy('userData.firstname')
      .addGroupBy('userData.surname')
      .addGroupBy('userData.organizationName')
      .getRawMany();

    return rows
      .map((r) => ({
        userDataId: r.userDataId,
        name: r.organizationName ?? [r.firstname, r.surname].filter((n) => n).join(' ') ?? '',
        count: Number(r.count),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(role: UserRole, jwtAccount: number, dto: CreateSupportNoteDto): Promise<SupportNote> {
    const department = this.resolveDepartmentForCreate(role, dto.department);

    if (dto.userDataId) {
      const userData = await this.userDataService.getUserData(dto.userDataId);
      if (!userData) throw new NotFoundException('User not found');
    }

    const author = await this.userDataService.getUserData(jwtAccount);
    if (!author) throw new ForbiddenException('Author user data not found');

    return this.noteRepo.save(
      this.noteRepo.create({
        userDataId: dto.userDataId,
        department,
        authorId: jwtAccount,
        authorMail: author.mail ?? `userData#${jwtAccount}`,
        subject: dto.subject,
        content: dto.content,
      }),
    );
  }

  async update(id: number, role: UserRole, jwtAccount: number, dto: UpdateSupportNoteDto): Promise<SupportNote> {
    const note = await this.noteRepo.findOneBy({ id });
    if (!note) throw new NotFoundException('Note not found');

    if (!this.canModify(note, role, jwtAccount)) {
      throw new ForbiddenException('Only the author or an admin can edit this note');
    }

    note.content = dto.content;
    note.subject = dto.subject;
    return this.noteRepo.save(note);
  }

  async delete(id: number, role: UserRole, jwtAccount: number): Promise<void> {
    const note = await this.noteRepo.findOneBy({ id });
    if (!note) throw new NotFoundException('Note not found');

    if (!this.canModify(note, role, jwtAccount)) {
      throw new ForbiddenException('Only the author or an admin can delete this note');
    }

    await this.noteRepo.remove(note);
  }

  toDto(note: SupportNote, role: UserRole, jwtAccount: number): SupportNoteDto {
    return {
      id: note.id,
      department: note.department,
      authorMail: note.authorMail,
      subject: note.subject,
      content: note.content,
      userDataId: note.userDataId,
      userName: note.userData?.completeName,
      isOwn: note.authorId === jwtAccount,
      isAdmin: role === UserRole.ADMIN,
      created: note.created,
      updated: note.updated,
    };
  }

  private resolveDepartmentForCreate(role: UserRole, requested: Department | undefined): Department {
    if (role === UserRole.ADMIN) {
      if (!requested) throw new ForbiddenException('Department is required when creating notes as admin');
      if (!ADMIN_DEPARTMENTS.includes(requested)) {
        throw new ForbiddenException(`Department ${requested} cannot be assigned to a note`);
      }
      return requested;
    }

    const dept = RoleDepartmentMap[role];
    if (!dept) throw new ForbiddenException('Role is not allowed to create notes');
    return dept;
  }

  private canModify(note: SupportNote, role: UserRole, jwtAccount: number): boolean {
    if (role === UserRole.ADMIN) return true;
    return note.authorId === jwtAccount;
  }
}
