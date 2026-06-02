import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class TemplateContentsDto {
  @IsString()
  @MaxLength(8000)
  de: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  en?: string;
}

export class TemplateContentsUpdateDto {
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  de?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  en?: string;
}

export class SupportIssueTemplateDto {
  id: number;
  name: string;
  contents: { de: string; en?: string };
  authorMail: string;
  isOwn: boolean;
  isAdmin: boolean;
  created: Date;
  updated: Date;
}

export class CreateSupportIssueTemplateDto {
  @IsString()
  @MaxLength(256)
  name: string;

  @ValidateNested()
  @Type(() => TemplateContentsDto)
  contents: TemplateContentsDto;
}

export class UpdateSupportIssueTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateContentsUpdateDto)
  contents?: TemplateContentsUpdateDto;
}

export class SupportIssueTemplateListQuery {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;
}
