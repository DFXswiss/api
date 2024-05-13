import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { SupportIssueReason } from '../entities/support-issue.entity';
import { CreateSupportMessageDto } from './create-support-message.dto';

export class CreateTransactionIssueDto extends CreateSupportMessageDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsEnum(SupportIssueReason)
  reason: SupportIssueReason;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  name: string;
}
