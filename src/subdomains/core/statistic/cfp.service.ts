import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Util } from 'src/shared/utils/util';
import { Config } from 'src/config/config';
import { CfpResult, ResultStatus, Vote, VotingType } from './dto/cfp.dto';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { DeFiClient, Proposal, ProposalType, ProposalVote } from 'src/integration/blockchain/ain/node/defi-client';
import { HttpService } from 'src/shared/services/http.service';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';

interface Masternodes {
  [id: string]: { ownerAuthAddress: string };
}

@Injectable()
export class CfpService implements OnModuleInit {
  private readonly lockUrl = 'https://api.lock.space/v1/masternode';
  private readonly cakeUrl = 'https://api.cakedefi.com/nodes?order=status&orderBy=DESC';

  private client: DeFiClient;
  private cfpResults: CfpResult[];
  private masternodeCount: number;
  private allMasternodes: Masternodes;
  private lockMasternodes: string[];
  private cakeMasternodes: [{ address: string }];
  private blockInfo: BlockchainInfo;
  constructor(nodeService: NodeService, private readonly http: HttpService) {
    nodeService.getConnectedNode(NodeType.REF).subscribe((client) => (this.client = client));
  }

  onModuleInit() {
    void this.doUpdate();
  }

  @Interval(600000)
  async doUpdate(): Promise<void> {
    try {
      // update masternodes
      this.allMasternodes = await this.client.listMasternodes();
      this.lockMasternodes = await this.callApi<any>(this.lockUrl);
      this.cakeMasternodes = await this.callApi<any>(this.cakeUrl);

      // update cfp results
      this.blockInfo = await this.client.getInfo();
      const currentProposals = await this.client.listProposal();
      this.masternodeCount = await this.client.getProposal(currentProposals[0].proposalId).then((p) => p.votesPossible);
      const filterProposal = currentProposals.filter((p) => this.blockInfo.blocks < p.proposalEndHeight + 20160);
      this.cfpResults = await Promise.all(filterProposal.map((cfp) => this.getCfpResult(cfp)));
    } catch (e) {
      console.error('Exception during CFP update:', e);
    }
  }

  async getCfpResults(): Promise<CfpResult[]> {
    return this.cfpResults;
  }

  // --- HELPER METHODS --- //

  private getVotes(proposalVotes: ProposalVote[]): Vote[] {
    return proposalVotes
      .filter((v) => this.allMasternodes[v.masternodeId] != null)
      .map((v) => ({
        address: this.allMasternodes[v.masternodeId].ownerAuthAddress,
        cfpId: v.proposalId,
        vote: v.vote,
        isCake:
          this.cakeMasternodes.find((n) => n.address === this.allMasternodes[v.masternodeId].ownerAuthAddress) != null,
        isLock: this.lockMasternodes.find((mn) => mn === this.allMasternodes[v.masternodeId].ownerAuthAddress) != null,
      }));
  }

  private async getCfpResult(proposal: Proposal): Promise<CfpResult> {
    const proposalVotes = this.getVotes(await this.client.listVotes(proposal.proposalId));
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

    const requiredVotes = parseFloat(proposal.approvalThreshold) / 100;
    const quorum = parseFloat(proposal.quorum) / 100;

    const currentResult = this.masternodeCount
      ? proposalVotes.length / this.masternodeCount > quorum && yesVotes.length / proposalVotes.length > requiredVotes
        ? ResultStatus.APPROVED
        : ResultStatus.NOT_APPROVED
      : undefined;

    return {
      title: proposal.title,
      number: proposal.proposalId,
      type:
        proposal.type === ProposalType.COMMUNITY_FUND_PROPOSAL
          ? VotingType.CFP
          : proposal.options?.includes('emergency')
          ? VotingType.SPECIAL
          : VotingType.DFIP,
      dfiAmount: proposal.amount,
      htmlUrl: proposal.context,
      currentResult: currentResult,
      status: proposal.status,
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
      lockVotes: {
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
      quorum,
      endDate: Util.daysAfter((proposal.proposalEndHeight - this.blockInfo.blocks) / 2880),
      endHeight: proposal.proposalEndHeight,
      creationHeight: proposal.creationHeight,
    };
  }

  private async callApi<T>(url: string): Promise<T> {
    return this.http.get<T>(`${url}`);
  }
}
