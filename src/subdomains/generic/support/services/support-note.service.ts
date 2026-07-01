import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ADMIN_ROLES, UserRole } from 'src/shared/auth/user-role.enum';
import {
  Department,
  getVisibleDepartments,
  RoleDepartmentMap,
} from 'src/subdomains/supporting/support-issue/enums/department.enum';
import { FindOptionsWhere, In, IsNull, Like, Not } from 'typeorm';
import { UserData } from '../../user/models/user-data/user-data.entity';
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

// Departments an admin may file a note in (note creation is restricted to these; viewing uses getVisibleDepartments)
const NOTE_CREATE_DEPARTMENTS: Department[] = [Department.SUPPORT, Department.COMPLIANCE, Department.MARKETING];
const SEARCH_LIMIT = 200;

@Injectable()
export class SupportNoteService {
  constructor(
    private readonly noteRepo: SupportNoteRepository,
    private readonly userDataService: UserDataService,
  ) {}

  async search(role: UserRole, query: SupportNoteListQuery): Promise<SupportNote[]> {
    const departments = getVisibleDepartments(role);
    if (departments?.length === 0) return [];

    const scope = query.scope ?? SupportNoteScope.ALL;
    // undefined => unrestricted (no department filter); a list => restricted to those departments
    const baseFilter: FindOptionsWhere<SupportNote> = departments ? { department: In(departments) } : {};

    if (scope === SupportNoteScope.FREE) {
      baseFilter.userData = IsNull();
    } else if (query.userDataId != null) {
      baseFilter.userData = { id: query.userDataId };
    } else if (scope === SupportNoteScope.BOUND) {
      baseFilter.userData = { id: Not(IsNull()) };
    }

    const search = query.search?.trim();
    const findOptions = {
      relations: { userData: true },
      order: { created: 'DESC' as const },
      take: SEARCH_LIMIT,
    };

    if (!search) return this.noteRepo.find({ where: baseFilter, ...findOptions });

    const pattern = `%${search}%`;
    const userDataWhere = (extra: FindOptionsWhere<UserData>): FindOptionsWhere<UserData> => ({
      ...((baseFilter.userData ?? {}) as FindOptionsWhere<UserData>),
      ...extra,
    });
    const where: FindOptionsWhere<SupportNote>[] = [
      { ...baseFilter, subject: Like(pattern) },
      { ...baseFilter, content: Like(pattern) },
      ...(scope === SupportNoteScope.FREE
        ? []
        : [
            { ...baseFilter, userData: userDataWhere({ firstname: Like(pattern) }) },
            { ...baseFilter, userData: userDataWhere({ surname: Like(pattern) }) },
            { ...baseFilter, userData: userDataWhere({ organizationName: Like(pattern) }) },
          ]),
    ];

    return this.noteRepo.find({ where, ...findOptions });
  }

  async listUsers(role: UserRole): Promise<SupportNoteUserDto[]> {
    const departments = getVisibleDepartments(role);
    if (departments?.length === 0) return [];

    const qb = this.noteRepo
      .createQueryBuilder('note')
      .innerJoin('note.userData', 'userData')
      .select('note.userDataId', 'userDataId')
      .addSelect('userData.firstname', 'firstname')
      .addSelect('userData.surname', 'surname')
      .addSelect('userData.organizationName', 'organizationName')
      .addSelect('COUNT(note.id)', 'count')
      .where('note.userDataId IS NOT NULL')
      .groupBy('note.userDataId')
      .addGroupBy('userData.firstname')
      .addGroupBy('userData.surname')
      .addGroupBy('userData.organizationName');

    // undefined => unrestricted; a list => restricted to those departments
    if (departments) qb.andWhere('note.department IN (:...departments)', { departments });

    const rows: Array<{
      userDataId: number;
      firstname?: string;
      surname?: string;
      organizationName?: string;
      count: string;
    }> = await qb.getRawMany();

    return rows
      .map((r) => ({
        userDataId: r.userDataId,
        name: r.organizationName ?? [r.firstname, r.surname].filter(Boolean).join(' ') ?? '',
        count: Number(r.count),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(role: UserRole, jwtAccount: number, dto: CreateSupportNoteDto): Promise<SupportNote> {
    const department = this.resolveDepartmentForCreate(role, dto.department);

    const userData = dto.userDataId ? await this.userDataService.getUserData(dto.userDataId) : undefined;
    if (dto.userDataId && !userData) throw new NotFoundException('User not found');

    const author = await this.userDataService.getUserData(jwtAccount);
    if (!author) throw new ForbiddenException('Author user data not found');

    return this.noteRepo.save(
      this.noteRepo.create({
        userData,
        department,
        authorId: jwtAccount,
        authorMail: author.mail ?? `userData#${jwtAccount}`,
        subject: dto.subject,
        content: dto.content,
      }),
    );
  }

  async update(id: number, role: UserRole, jwtAccount: number, dto: UpdateSupportNoteDto): Promise<SupportNote> {
    const note = await this.noteRepo.findOne({ where: { id }, relations: { userData: true } });
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
      userDataId: note.userData?.id,
      userName: note.userData?.completeName,
      isOwn: note.authorId === jwtAccount,
      isAdmin: ADMIN_ROLES.includes(role),
      created: note.created,
      updated: note.updated,
    };
  }

  private resolveDepartmentForCreate(role: UserRole, requested: Department | undefined): Department {
    if (ADMIN_ROLES.includes(role)) {
      if (!requested) throw new ForbiddenException('Department is required when creating notes as admin');
      if (!NOTE_CREATE_DEPARTMENTS.includes(requested)) {
        throw new ForbiddenException(`Department ${requested} cannot be assigned to a note`);
      }
      return requested;
    }

    const dept = RoleDepartmentMap[role];
    if (!dept) throw new ForbiddenException('Role is not allowed to create notes');
    return dept;
  }

  private canModify(note: SupportNote, role: UserRole, jwtAccount: number): boolean {
    if (ADMIN_ROLES.includes(role)) return true;
    return note.authorId === jwtAccount;
  }
}
