import { ProposalStatus } from '@defichain/jellyfish-api-core/dist/category/governance';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface CfpSettings {
  inProgress: boolean;
  votingOpen: boolean;
  currentRound: string;
  startDate: string;
  endDate: string;
}

export enum ResultStatus {
  APPROVED = 'Approved',
  NOT_APPROVED = 'Not approved',
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
  @ApiProperty({ description: 'Proposal ID' })
  number: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: VotingType })
  type: VotingType;

  @ApiProperty()
  dfiAmount: number;

  @ApiProperty()
  quorum: number;

  @ApiProperty()
  htmlUrl: string;

  @ApiProperty({ enum: ResultStatus })
  currentResult: ResultStatus;

  @ApiProperty({ enum: ProposalStatus })
  status: ProposalStatus;

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
  endDate: Date;

  @ApiProperty()
  endHeight: number;
}
