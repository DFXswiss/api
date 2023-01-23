import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as CfpResults from './assets/cfp-results.json';
import { Interval } from '@nestjs/schedule';
import { Util } from 'src/shared/utils/util';
import { Config } from 'src/config/config';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { DeFiClient, Proposal, ProposalVote } from 'src/integration/blockchain/ain/node/defi-client';
import { ProposalType } from '@defichain/jellyfish-api-core/dist/category/governance';
import { HttpService } from 'src/shared/services/http.service';

export interface CfpSettings {
  inProgress: boolean;
  votingOpen: boolean;
  currentRound: string;
  startDate: string;
  endDate: string;
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
  number: string;
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
  dfxVotes?: {
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

interface Masternodes {
  [id: string]: { ownerAuthAddress: string };
}

@Injectable()
export class CfpService implements OnModuleInit {
  private readonly myDefichainUrl = 'https://api.mydeficha.in/v1/listmasternodes/';
  private readonly lockUrl = 'https://api.lock.space/v1/masternode';
  private readonly cakeUrl = 'https://api.cakedefi.com/nodes?order=status&orderBy=DESC';

  private client: DeFiClient;
  private settings: CfpSettings;
  private cfpResults: CfpResult[];
  private masternodeCount: number;
  private allMasternodes: Masternodes;
  private lockMasternodes: string[];
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

      if (this.settings.inProgress) {
        // update masternodes
        this.allMasternodes = await this.callApi<any>(this.myDefichainUrl);
        this.lockMasternodes = await this.callApi<any>(this.lockUrl);
        this.cakeMasternodes = await this.callApi<any>(this.cakeUrl);

        // update cfp results
        const currentProposals = await this.client.listProposal();
        this.masternodeCount = await this.client
          .getProposal(currentProposals[0].proposalId)
          .then((p) => p.votesPossible);
        this.cfpResults = await Promise.all(currentProposals.map((cfp) => this.getCfpResult(cfp)));
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

  private getVotes(proposalVote: ProposalVote[]): Vote[] {
    return proposalVote.map((m) => ({
      address: this.allMasternodes[m.masternodeId].ownerAuthAddress,
      cfpId: m.proposalId,
      vote: m.vote,
      isCake:
        this.cakeMasternodes.find((n) => n.address === this.allMasternodes[m.masternodeId].ownerAuthAddress) != null,
      isLock: this.lockMasternodes.find((mn) => mn === this.allMasternodes[m.masternodeId].ownerAuthAddress) != null,
    }));
  }

  private async getCfpResult(proposal: Proposal): Promise<CfpResult> {
    const proposalVotes = await this.getVotes(await this.client.listVotes(proposal.proposalId));
    const yesVotes = proposalVotes.filter((v) => v.vote.toLowerCase().endsWith('yes'));
    const noVotes = proposalVotes.filter((v) => v.vote.toLowerCase().endsWith('no'));
    const neutralVotes = proposalVotes.filter((v) => v.vote.toLowerCase().endsWith('neutral'));

    const cakeVotes = proposalVotes.filter((v) => v.isCake);
    const yesVotesCake = yesVotes.filter((v) => v.isCake);
    const noVotesCake = noVotes.filter((v) => v.isCake);
    const neutralVotesCake = neutralVotes.filter((v) => v.isCake);

    const lockVotes = proposalVotes.filter((v) => v.isLock);
    const yesVotesLock = yesVotes.filter((v) => v.isLock);
    const noVotesLock = noVotes.filter((v) => v.isLock);
    const neutralVotesLock = neutralVotes.filter((v) => v.isLock);

    const requiredVotes = proposal.type === ProposalType.COMMUNITY_FUND_REQUEST ? 1 / 2 : 2 / 3;
    const currentResult =
      yesVotes.length / (yesVotes.length + noVotes.length) > requiredVotes
        ? ResultStatus.APPROVED
        : ResultStatus.NOT_APPROVED;

    return {
      title: proposal.title,
      number: proposal.proposalId,
      type: proposal.type === ProposalType.COMMUNITY_FUND_REQUEST ? VotingType.CFP : VotingType.DFIP,
      dfiAmount: proposal.amount,
      htmlUrl: proposal.context,
      currentResult: currentResult,
      totalVotes: {
        total: proposalVotes.length,
        possible: this.masternodeCount,
        turnout: Util.round((proposalVotes.length / this.masternodeCount) * 100, Config.defaultPercentageDecimal),
        yes: yesVotes.length,
        neutral: neutralVotes.length,
        no: noVotes.length,
      },
      cakeVotes: {
        total: cakeVotes.length,
        yes: yesVotesCake.length,
        neutral: neutralVotesCake.length,
        no: noVotesCake.length,
      },
      dfxVotes: {
        total: lockVotes.length,
        yes: yesVotesLock.length,
        neutral: neutralVotesLock.length,
        no: noVotesLock.length,
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
    return this.http.get<T>(`${url}`);
  }
}
