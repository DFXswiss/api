import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CryptoService } from 'src/ain/services/crypto.service';
import { HttpService } from '../shared/services/http.service';
import { ConversionService } from 'src/shared/services/conversion.service';
import * as MasterNodes from '../assets/master-nodes.json';
import * as CfpResults from '../assets/cfp-results.json';
import { Interval } from '@nestjs/schedule';

interface CfpResponse {
  number: number;
  title: string;
  html_url: string;
  labels: { name: string }[];
  comments: number;
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

interface Vote {
  address: string;
  signature: string;
  cfpId: string;
  vote: string;
}

export interface MasterNode {
  ownerAuthAddress: string;
  mintedBlocks: number;
  state: State;
}

export interface CfpResult {
  number: number;
  title: string;
  html_url: string;
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
  private readonly isCfpInProgress = false;
  private readonly regExp = /signmessage\s"?(\w*)"?\s"?(cfp-(2109-\d*)-\w*)"?\s+(\S{87}=)(?:\s|$)+/gm;
  private readonly issuesUrl = 'https://api.github.com/repos/DeFiCh/dfips/issues';
  private readonly masterNodeUrl = 'https://api.mydeficha.in/v1/listmasternodes/';

  private masterNodeCount: number;
  private masterNodes: { [address: string]: MasterNode };
  private cfpResults: CfpResult[];

  constructor(
    private http: HttpService,
    private cryptoService: CryptoService,
    private conversionService: ConversionService,
  ) {
    const validMasterNodes = MasterNodes.filter((node) => node.state === State.ENABLED && node.mintedBlocks > 0);
    this.masterNodeCount = validMasterNodes.length;
    this.masterNodes = validMasterNodes.reduce((prev, curr) => ({ ...prev, [curr.ownerAuthAddress]: curr }), {});
  }

  @Interval(600000)
  async doUpdate(): Promise<void> {
    try {
      let allCfp = await this.callApi<CfpResponse[]>(this.issuesUrl, ``);
      allCfp = allCfp.filter((cfp) => cfp.labels.find((l) => l.name === 'cfp'));

      this.cfpResults = await Promise.all(allCfp.map((cfp) => this.getCfp(cfp)));
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to update');
    }
  }

  async getMasterNodes(): Promise<MasterNode[]> {
    const response = await this.callApi<{ [key: string]: MasterNode }>(this.masterNodeUrl, ``);
    return Object.values(response).map((n) => ({
      ownerAuthAddress: n.ownerAuthAddress,
      mintedBlocks: n.mintedBlocks,
      state: n.state,
    }));
  }

  getCfpList(): string[] {
    return Object.keys(CfpResults).reverse();
  }

  async getCfpResults(cfpId: string): Promise<CfpResult[]> {
    if (cfpId === 'latest') {
      if (this.isCfpInProgress) {
        // return current data from GitHub
        if (!this.cfpResults) await this.doUpdate();
        return this.cfpResults;
      }

      // return newest cached data
      cfpId = Object.keys(CfpResults).pop();
    }

    const results = CfpResults[cfpId];
    if (!results) throw new NotFoundException('No CFP result for id found');

    return results;
  }

  // --- HELPER METHODS --- //
  private async getCfp(cfp: CfpResponse): Promise<CfpResult> {
    const batchSize = 100;
    const batchCount = Math.ceil(cfp.comments / batchSize);
    const commentBatches = await Promise.all(
      [...Array(batchCount).keys()].map((_, i) =>
        this.callApi<CommentsResponse[]>(this.issuesUrl, `/${cfp.number}/comments?per_page=${batchSize}&page=${i + 1}`),
      ),
    );
    const comments = commentBatches.reduce((prev, curr) => prev.concat(curr), []);

    return this.getCfpResult(cfp, comments);
  }

  private async getCfpResult(cfp: CfpResponse, comments: CommentsResponse[]): Promise<CfpResult> {
    const validVotes: { [address: string]: Vote } = comments
      .map((c) => this.getCommentVotes(c.body))
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((v) => this.verifyVote(cfp, v))
      .reduce((prev, curr) => ({ ...prev, [curr.address]: curr }), {}); // remove duplicate votes
    const votes = Object.values(validVotes);

    const voteCount = votes.length;
    const yesVoteCount = votes.filter((v) => v.vote.endsWith('yes')).length;
    const neutralVoteCount = votes.filter((v) => v.vote.endsWith('neutral')).length;
    const noVoteCount = votes.filter((v) => v.vote.endsWith('no')).length;

    return {
      title: cfp.title,
      number: cfp.number,
      html_url: cfp.html_url,
      yes: yesVoteCount,
      neutral: neutralVoteCount,
      no: noVoteCount,
      votes: voteCount,
      possibleVotes: this.masterNodeCount,
      voteTurnout: this.conversionService.round((voteCount / this.masterNodeCount) * 100, 2),
      currentResult: yesVoteCount > noVoteCount ? ResultStatus.APPROVED : ResultStatus.NOT_APPROVED,
    };
  }

  private getCommentVotes(comment: string): Vote[] {
    const matches = [];

    let match;
    while ((match = this.regExp.exec(comment)) !== null) {
      matches.push(match);
    }

    return matches.map((m) => ({
      address: m[1],
      signature: m[4],
      cfpId: m[3],
      vote: m[2],
    }));
  }

  private verifyVote(cfp: CfpResponse, vote: Vote): boolean {
    return (
      this.masterNodes[vote.address] &&
      cfp.title.includes(vote.cfpId) &&
      this.cryptoService.verifySignature(vote.vote, vote.address, vote.signature)
    );
  }

  private async callApi<T>(baseUrl: string, url: string): Promise<T> {
    return this.http.get<T>(`${baseUrl}${url}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}` } });
  }
}
