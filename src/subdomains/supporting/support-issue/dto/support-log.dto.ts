import { LimitRequest, LimitRequestDecision } from '../entities/limit-request.entity';
import { SupportIssue } from '../entities/support-issue.entity';
import { Department } from '../enums/department.enum';
import { SupportIssueState } from '../enums/support-issue.enum';
import { SupportLogType } from '../enums/support-log.enum';

export class SupportLogDto {
  type: SupportLogType;
  message?: string;
  comment?: string;
  clerk?: string;
  eventDate?: Date;
  department?: Department;
  decision?: LimitRequestDecision;
  state?: SupportIssueState;
  supportIssue?: SupportIssue;
  limitRequest?: LimitRequest;
}
