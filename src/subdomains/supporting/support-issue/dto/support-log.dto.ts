import { LimitRequest, LimitRequestDecision } from '../entities/limit-request.entity';
import { SupportIssue } from '../entities/support-issue.entity';
import { Department } from '../enums/department.enum';
import { SupportIssueInternalState } from '../enums/support-issue.enum';
import { SupportLogType } from '../enums/support-log.enum';

export interface SupportLogDto {
  type: SupportLogType;
  message?: string;
  comment?: string;
  clerk?: string;
  eventDate?: Date;
  department?: Department;
  decision?: LimitRequestDecision;
  state?: SupportIssueInternalState;
  supportIssue?: SupportIssue;
  limitRequest?: LimitRequest;
}
