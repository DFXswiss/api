import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DeFiService } from './defi.service';
import { HttpService } from './http.service';

interface CfpResponse {
  number: number;
  title: string;
}

interface CommentsResponse {
  body: string;
}

enum ResultStatus {
  APPROVED = 'Approved',
  NOT_APPROVED = 'Not approved',
}

enum State {
  ENABLED = 'ENABLED',
  PRE_ENABLED = 'PRE_ENABLED',
}

interface MasterNodeResponse {
  ownerAuthAddress: string;
  creationHeight: number;
  mintedBlocks: number;
  state: State;
}

interface CfpResult {
  number: number;
  title: string;
  yes: number;
  neutral: number;
  no: number;
  votes: number;
  possibleVotes: number;
  voteTurnout: number;
  currentResult: ResultStatus;
}

@Injectable()
export class CfpService {
  private issuesUrl = 'https://api.github.com/repos/DeFiCh/dfips/issues';
  private masterNodeUrl = 'https://api.mydeficha.in/v1/listmasternodes/';
  private masterNodeVotesCounter: number;
  private cfpResult: CfpResult[];
  private masterNodeList: MasterNodeResponse[];
  constructor(private http: HttpService, private deFiService: DeFiService) {}

  async getDfxResults(): Promise<any> {
    if (!this.cfpResult) await this.doUpdate();
    return [this.cfpResult[2], this.cfpResult[5]];
  }

  async getAllCfpResults(): Promise<any> {
    if (!this.cfpResult) await this.doUpdate();
    return this.cfpResult;
  }

  async doUpdate() {
    try {
      const allCfp = await this.callApi<CfpResponse[]>(this.issuesUrl, ``);
      await this.getMasterNodeList();
      this.cfpResult = [];

      for (const cfp in allCfp) {
        if (!allCfp[cfp].title.includes('Announcement:')) {
          const allComments = await this.callApi<CommentsResponse[]>(this.issuesUrl, `/${allCfp[cfp].number}/comments`);
          let result = await this.getVotes(allCfp[cfp].title, allCfp[cfp].number, allComments, this.masterNodeList);
          this.cfpResult.push(result);
        }
      }
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to update');
    }
  }

  private async getVotes(
    title: string,
    number: number,
    comments: CommentsResponse[],
    masterNodes: MasterNodeResponse[],
  ): Promise<CfpResult> {
    const validVotes = comments
      .map((c) => this.getCommentVotes(c.body))
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((v) => this.verifyVote(v.address, v.signature, v.vote, masterNodes));

    const voteCount = validVotes.length;
    const yesVoteCount = validVotes.filter((v) => v.vote === 'yes').length;
    const neutralVoteCount = validVotes.filter((v) => v.vote === 'neutral').length;
    const noVoteCount = validVotes.filter((v) => v.vote === 'no').length;

    return {
      title: title,
      number: number,
      yes: yesVoteCount,
      neutral: neutralVoteCount,
      no: noVoteCount,
      votes: voteCount,
      possibleVotes: this.masterNodeVotesCounter,
      voteTurnout: Math.round((voteCount / this.masterNodeVotesCounter) * 100 * Math.pow(10, 2)) / Math.pow(10, 2),
      currentResult: yesVoteCount >= noVoteCount ? ResultStatus.APPROVED : ResultStatus.NOT_APPROVED,
    };
  }

  private getCommentVotes(comment: string): { address: string; signature: string; vote: string }[] {
    const matches = [];
    const regExp = /signmessage\s(\w*)\s"?cfp-2109-\d*-(\w*)"?[\r\n]+(\S*=)/gm;

    let match;
    while ((match = regExp.exec(comment)) !== null) {
      matches.push(match);
    }

    return matches.map((m) => ({
      address: m[1],
      signature: m[3],
      vote: m[2],
    }));
  }

  private async verifyVote(
    address: string,
    signature: string,
    vote: string,
    masterNodes: MasterNodeResponse[],
  ): Promise<boolean> {
    if (!address.startsWith('8')) return false;
    if (!signature.endsWith('=')) return false;
    if (!vote.startsWith('cfp-2109-')) return false;
    if (!this.deFiService.verifySignature(vote, address, signature)) return false;

    for (const key in masterNodes) {
      if (
        masterNodes[key].mintedBlocks > 0 &&
        masterNodes[key].creationHeight < 1204845 &&
        masterNodes[key].state === State.ENABLED
      ) {
        if (masterNodes[key].ownerAuthAddress === address) return true;
      }
    }
    return false;
  }

  // --- HELPER METHODS --- //
  private async callApi<T>(baseUrl: string, url: string): Promise<T> {
    return this.http.request<T>({
      url: `${baseUrl}${url}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}` },
    });
  }

  private async getMasterNodeList() {
    const masterNodes = await this.callApi<MasterNodeResponse[]>(this.masterNodeUrl, ``);
    this.masterNodeVotesCounter = 0;

    for (const key in masterNodes) {
      if (
        masterNodes[key].state === State.ENABLED &&
        masterNodes[key].mintedBlocks > 0 &&
        masterNodes[key].creationHeight < 1204845
      ) {
        this.masterNodeVotesCounter++;
      }
    }

    this.masterNodeList = masterNodes;
  }
}
