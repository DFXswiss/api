import { ApiProperty } from '@nestjs/swagger';

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

export interface Vote {
  address: string;
  signature: string;
  cfpId: string;
  vote: string;
  createdAt: string;
  isCake: boolean;
  isDfx: boolean;
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

class CakeVotesDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  yes: number;

  @ApiProperty()
  neutral: number;

  @ApiProperty()
  no: number;
}

class DfxVotesDto {
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
  @ApiProperty()
  yes: Vote[];

  @ApiProperty()
  neutral: Vote[];

  @ApiProperty()
  no: Vote[];
}

export class CfpResult {
  @ApiProperty()
  number: number;

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

  @ApiProperty({ type: CakeVotesDto })
  cakeVotes: CakeVotesDto;

  @ApiProperty({ type: DfxVotesDto })
  dfxVotes: DfxVotesDto;

  @ApiProperty({ type: VoteDetailsDto })
  voteDetails: VoteDetailsDto;

  @ApiProperty()
  startDate: string;

  @ApiProperty()
  endDate: string;
}
