import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as CfpResults from './assets/cfp-results.json';
import { Interval } from '@nestjs/schedule';
import { Util } from 'src/shared/utils/util';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { ProposalStatus, ProposalType } from '@defichain/jellyfish-api-core/dist/category/governance';
import { HttpService } from 'src/shared/services/http.service';

export interface CfpSettings {
  inProgress: boolean;
  votingOpen: boolean;
  currentRound: string;
  startDate: string;
  endDate: string;
}

export interface Proposal {
  proposalId: string;
  title: string;
  context: string;
  contextHash: string;
  status: ProposalStatus;
  type: ProposalType;
  amount: number;
  payoutAddress: string;
  currentCycle: number;
  totalCycles: number;
  cycleEndHeight: number;
  proposalEndHeight: number;
  votingPeriod: number;
  quorum: string;
  votesPossible: number;
  votesPresent: number;
  votesPresentPct: string;
  votesYes: number;
  votesYesPct: string;
  approvalThreshold: string;
  fee: number;
  proposalVotes: Vote[];
}

export interface ProposalVote {
  proposalId: string;
  masternodeId: string;
  cycle: number;
  vote: VoteResult;
}

enum VoteResult {
  YES = 'YES',
  NO = 'NO',
  NEUTRAL = 'NEUTRAL',
}

enum ResultStatus {
  APPROVED = 'Approved',
  NOT_APPROVED = 'Not approved',
}

enum VotingType {
  CFP = 'cfp',
  DFIP = 'dfip',
}

interface Vote {
  address: string;
  cfpId: string;
  vote: string;
  signature?: string;
  createdAt?: string;
  isCake?: boolean;
  isLock?: boolean;
}

export interface CfpResult {
  number?: number;
  title: string;
  type: VotingType;
  dfiAmount: number;
  htmlUrl: string;
  currentResult: ResultStatus;
  totalVotes: {
    total: number;
    possible: number;
    turnout: number;
    yes: number;
    neutral: number;
    no: number;
  };
  cakeVotes?: {
    total: number;
    yes: number;
    neutral: number;
    no: number;
  };
  lockVotes?: {
    total: number;
    yes: number;
    neutral: number;
    no: number;
  };
  voteDetails: {
    yes: Vote[];
    neutral: Vote[];
    no: Vote[];
  };
  startDate: string;
  endDate: string;
}

@Injectable()
export class CfpService implements OnModuleInit {
  private readonly myDefichainUrl = 'https://api.mydeficha.in/v1/listmasternodes/';
  private readonly lockUrl = 'https://api.lock.space/v1/analytics/staking/masternodes';
  private readonly cakeUrl = 'https://api.cakedefi.com/nodes?order=status&orderBy=DESC';

  private client: DeFiClient;
  private settings: CfpSettings;
  private cfpResults: CfpResult[];
  private masternodeCount: number;
  private allMasternodes;
  private lockMasternodes: [{ owner: string }];
  private cakeMasternodes: [{ address: string }];
  constructor(
    nodeService: NodeService,
    private readonly settingService: SettingService,
    private readonly http: HttpService,
  ) {
    nodeService.getConnectedNode(NodeType.REF).subscribe((client) => (this.client = client));
  }

  onModuleInit() {
    void this.doUpdate();
  }

  @Interval(600000)
  async doUpdate(): Promise<void> {
    try {
      // update settings
      this.settings = await this.settingService.getObj<CfpSettings>('cfp');
      // update masternodes
      this.allMasternodes = await this.callApi<any>(this.myDefichainUrl);
      try {
        this.lockMasternodes = await this.callApi<any>(this.lockUrl);
        this.cakeMasternodes = await this.callApi<any>(this.cakeUrl);
      } catch (e) {
        console.error('Failed to get lock/cake masternodes', e);
      }
      // update cfp results
      if (this.settings.inProgress) {
        const allProposal = await this.getCurrentProposals();
        this.cfpResults = await Promise.all(allProposal.map((cfp) => this.getCfpResult(cfp)));
      }
    } catch (e) {
      console.error('Exception during CFP update:', e);
    }
  }

  getCfpList(): string[] {
    const cfpList = Object.keys(CfpResults);
    if (this.settings.currentRound && !cfpList.includes(this.settings.currentRound))
      cfpList.push(this.settings.currentRound);

    return cfpList.reverse();
  }

  async getCurrentProposals(): Promise<Proposal[]> {
    const currentProposals = await this.client.listProposal();
    this.masternodeCount = await this.client.getProposal(currentProposals[0].proposalId).then((p) => p.votesPossible);

    for (const proposal of currentProposals) {
      proposal.proposalVotes = await this.getVotes(await this.client.listVotes(proposal.proposalId));
    }

    return currentProposals;
  }

  async getCfpResults(cfpId: string): Promise<CfpResult[]> {
    if (['latest', this.settings.currentRound].includes(cfpId)) {
      if (this.settings.inProgress) {
        // return current data from node (on-chain)
        return this.cfpResults;
      }

      // return newest cached data
      cfpId = Object.keys(CfpResults).pop();
    }

    const results = CfpResults[cfpId];
    if (!results) throw new NotFoundException('CFP not found');

    return results;
  }

  // --- HELPER METHODS --- //

  private async getVotes(proposalVote: ProposalVote[]): Promise<Vote[]> {
    return Promise.all(
      proposalVote.map(async (m) => ({
        address: this.allMasternodes[m.masternodeId]['ownerAuthAddress'],
        cfpId: m.proposalId,
        vote: m.vote,
        isCake:
          Object.values(this.cakeMasternodes).find(
            (n) => n.address === this.allMasternodes[m.masternodeId]['ownerAuthAddress'],
          ) != null,
        isLock:
          this.lockMasternodes.find((n) => n.owner === this.allMasternodes[m.masternodeId]['ownerAuthAddress']) != null,
      })),
    );
  }

  private async getCfpResult(proposal: Proposal): Promise<CfpResult> {
    const yesVotes = proposal.proposalVotes.filter((v) => v.vote.toLowerCase().endsWith('yes'));
    const noVotes = proposal.proposalVotes.filter((v) => v.vote.toLowerCase().endsWith('no'));
    const neutralVotes = proposal.proposalVotes.filter((v) => v.vote.toLowerCase().endsWith('neutral'));

    const requiredVotes = proposal.type === ProposalType.COMMUNITY_FUND_REQUEST ? 1 / 2 : 2 / 3;
    const currentResult =
      yesVotes.length / (yesVotes.length + noVotes.length) > requiredVotes
        ? ResultStatus.APPROVED
        : ResultStatus.NOT_APPROVED;

    return {
      title: proposal.title,
      type: proposal.type === ProposalType.COMMUNITY_FUND_REQUEST ? VotingType.CFP : VotingType.DFIP,
      dfiAmount: proposal.amount,
      htmlUrl: proposal.contextHash,
      currentResult: currentResult,
      totalVotes: {
        total: proposal.proposalVotes.length,
        possible: this.masternodeCount,
        turnout: Util.round(
          (proposal.proposalVotes.length / this.masternodeCount) * 100,
          Config.defaultPercentageDecimal,
        ),
        yes: yesVotes.length,
        neutral: neutralVotes.length,
        no: noVotes.length,
      },
      voteDetails: {
        yes: yesVotes,
        neutral: neutralVotes,
        no: noVotes,
      },
      startDate: this.settings.startDate,
      endDate: this.settings.endDate,
    };
  }

  private async callApi<T>(url: string): Promise<T> {
    return this.http.get<T>(`${url}`, { headers: { Authorization: `Bearer DFX` } });
  }
}
