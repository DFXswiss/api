import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DeFiService } from './defi.service';
import { HttpService } from './http.service';

interface CfpResponse {
  number: number;
  title: string;
  labels: { name: string }[];
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

interface Vote {
  address: string;
  signature: string;
  vote: string;
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
  private cfpResults: CfpResult[];
  private masterNodeCount: number;
  private masterNodes: MasterNodeResponse[] = [];
  constructor(private http: HttpService, private deFiService: DeFiService) {}

  async getDfxResults(): Promise<any> {
    if (!this.cfpResults) await this.doUpdate();
    return this.cfpResults.filter((r) => [66, 70].includes(r.number));
  }

  async getAllCfpResults(): Promise<any> {
    if (!this.cfpResults) await this.doUpdate();
    return this.cfpResults;
  }

  async doUpdate(): Promise<void> {
    try {
      await this.getMasterNodes();

      let allCfp = await this.callApi<CfpResponse[]>(this.issuesUrl, ``);
      allCfp = allCfp.filter((cfp) => cfp.labels.find((l) => l.name === 'cfp'));

      this.cfpResults = await Promise.all(allCfp.map((cfp) => this.getCfp(cfp)));
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to update');
    }
  }

  // --- HELPER METHODS --- //
  private async getCfp(cfp: CfpResponse): Promise<CfpResult> {
    const comments = await this.callApi<CommentsResponse[]>(this.issuesUrl, `/${cfp.number}/comments?per_page=1000`);
    return this.getCfpResult(cfp.title, cfp.number, comments);
  }

  private async getCfpResult(title: string, number: number, comments: CommentsResponse[]): Promise<CfpResult> {
    const validVotes = comments
      .map((c) => this.getCommentVotes(c.body))
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((v) => this.verifyVote(v.address, v.signature, v.vote, this.masterNodes));

    const voteCount = validVotes.length;
    const yesVoteCount = validVotes.filter((v) => v.vote.endsWith('yes')).length;
    const neutralVoteCount = validVotes.filter((v) => v.vote.endsWith('neutral')).length;
    const noVoteCount = validVotes.filter((v) => v.vote.endsWith('no')).length;

    return {
      title: title,
      number: number,
      yes: yesVoteCount,
      neutral: neutralVoteCount,
      no: noVoteCount,
      votes: voteCount,
      possibleVotes: this.masterNodeCount,
      voteTurnout: Math.round((voteCount / this.masterNodeCount) * 100 * Math.pow(10, 2)) / Math.pow(10, 2),
      currentResult: yesVoteCount >= noVoteCount ? ResultStatus.APPROVED : ResultStatus.NOT_APPROVED,
    };
  }

  private getCommentVotes(comment: string): Vote[] {
    const matches = [];
    const regExp = /signmessage\s"?(\w*)"?\s"?(cfp-2109-\d*-\w*)"?[\r\n\s]+(\S*=)/gm;

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

  private verifyVote(address: string, signature: string, vote: string, masterNodes: MasterNodeResponse[]): boolean {
    return (
      address.startsWith('8') &&
      signature.endsWith('=') &&
      this.deFiService.verifySignature(vote, address, signature) &&
      masterNodes.find((n) => n.ownerAuthAddress === address) != null
    );
  }

  private async getMasterNodes(): Promise<void> {
    const response = await this.callApi<{ [key: string]: MasterNodeResponse }>(this.masterNodeUrl, ``);
    this.masterNodes = Object.values(response)
      .filter((node) => node.state === State.ENABLED && node.mintedBlocks > 0 && node.creationHeight < 1204845);
    this.masterNodeCount = this.masterNodes.length;
  }

  private async callApi<T>(baseUrl: string, url: string): Promise<T> {
    return this.http.request<T>({
      url: `${baseUrl}${url}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}` },
    });
  }
}
