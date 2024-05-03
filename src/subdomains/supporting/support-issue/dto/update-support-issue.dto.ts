import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { SupportIssueState } from '../entities/support-issue.entity';

export class UpdateSupportIssueDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(SupportIssueState)
  state: SupportIssueState;
}
