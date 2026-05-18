import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { Department } from 'src/subdomains/supporting/support-issue/enums/department.enum';

export class SupportNoteDto {
  id: number;
  department: Department;
  authorMail: string;
  subject?: string;
  content: string;
  userDataId?: number;
  userName?: string;
  isOwn: boolean;
  isAdmin: boolean;
  created: Date;
  updated: Date;
}

export class CreateSupportNoteDto {
  @IsOptional()
  @IsInt()
  userDataId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  subject?: string;

  @IsString()
  @MaxLength(8000)
  content: string;

  // Only honored when the caller is ADMIN. For other roles the department is
  // derived from the role via RoleDepartmentMap.
  @IsOptional()
  @IsEnum(Department)
  department?: Department;
}

export class UpdateSupportNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  subject?: string;

  @IsString()
  @MaxLength(8000)
  content: string;
}

export enum SupportNoteScope {
  ALL = 'all',
  FREE = 'free',
  BOUND = 'bound',
}

export class SupportNoteListQuery {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;

  @IsOptional()
  @IsEnum(SupportNoteScope)
  scope?: SupportNoteScope;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  userDataId?: number;
}

export class SupportNoteUserDto {
  userDataId: number;
  name: string;
  count: number;
}
