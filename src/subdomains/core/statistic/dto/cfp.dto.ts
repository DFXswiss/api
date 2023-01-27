import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CfpSettings {
  @ApiProperty()
  inProgress: boolean;

  @ApiProperty()
  votingOpen: boolean;

  @ApiProperty()
  currentRound: string;

  @ApiProperty()
  startDate: string;

  @ApiProperty()
  endDate: string;
}

export interface CfpResponse {
  number: number;
  title: string;
  html_url: string;
  labels: { name: string }[];
  comments: number;
}

export interface CommentsResponse {
  body: string;
  created_at: string;
}

export enum ResultStatus {
  APPROVED = 'Approved',
  NOT_APPROVED = 'Not approved',
}

export enum State {
  ENABLED = 'ENABLED',
  PRE_ENABLED = 'PRE_ENABLED',
}

export enum VotingType {
  CFP = 'cfp',
  DFIP = 'dfip',
}

export class Vote {
  @ApiProperty()
  address: string;

  @ApiProperty()
  cfpId: string;

  @ApiProperty()
  vote: string;

  @ApiPropertyOptional()
  signature?: string;

  @ApiPropertyOptional()
  createdAt?: string;

  @ApiPropertyOptional()
  isCake?: boolean;

  @ApiPropertyOptional()
  isLock?: boolean;
}

export interface MasterNode {
  ownerAuthAddress: string;
  mintedBlocks: number;
  state: State;
}

class TotalVotesDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  possible: number;

  @ApiProperty()
  turnout: number;

  @ApiProperty()
  yes: number;

  @ApiProperty()
  neutral: number;

  @ApiProperty()
  no: number;
}

class ServiceVotesDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  yes: number;

  @ApiProperty()
  neutral: number;

  @ApiProperty()
  no: number;
}

class VoteDetailsDto {
  @ApiProperty({ type: Vote, isArray: true })
  yes: Vote[];

  @ApiProperty({ type: Vote, isArray: true })
  neutral: Vote[];

  @ApiProperty({ type: Vote, isArray: true })
  no: Vote[];
}

export class CfpResult {
  @ApiProperty()
  number: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: VotingType })
  type: VotingType;

  @ApiProperty()
  dfiAmount: number;

  @ApiProperty()
  htmlUrl: string;

  @ApiProperty({ enum: ResultStatus })
  currentResult: ResultStatus;

  @ApiProperty({ type: TotalVotesDto })
  totalVotes: TotalVotesDto;

  @ApiPropertyOptional({ type: ServiceVotesDto })
  cakeVotes?: ServiceVotesDto;

  @ApiPropertyOptional({ type: ServiceVotesDto })
  dfxVotes?: ServiceVotesDto;

  @ApiPropertyOptional({ type: ServiceVotesDto })
  lockVotes?: ServiceVotesDto;

  @ApiProperty({ type: VoteDetailsDto })
  voteDetails: VoteDetailsDto;

  @ApiProperty()
  startDate: string;

  @ApiProperty()
  endDate: string;
}
