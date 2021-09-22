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
  private masterNodeVotesCounter = 0;
  constructor(private http: HttpService, private deFiService: DeFiService) {}

  async getCfpResult(cfpNumber: number): Promise<any> {
    try {
      const cfp = await this.callApi<CfpResponse>(this.issuesUrl, `/${cfpNumber}`);
      let allComments = await this.callApi<CommentsResponse[]>(this.issuesUrl, `/${cfpNumber}/comments`);
      return await this.getVotes(cfp.title, cfpNumber, allComments, await this.getMasterNodeList());
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed get DFX CFP Result');
    }
  }

  async getDfxResults(): Promise<any> {
    let cfpResults = [];
    cfpResults.push(await this.getCfpResult(70));
    cfpResults.push(await this.getCfpResult(66));
    return cfpResults;
  }

  async getAllCfpResults(): Promise<any> {
    try {
      const allCfp = await this.callApi<CfpResponse[]>(this.issuesUrl, ``);

      let resultsCfp = [];

      for (const cfp in allCfp) {
        const allComments = await this.callApi<CommentsResponse[]>(this.issuesUrl, `/${allCfp[cfp].number}/comments`);
        let result = await this.getVotes(
          allCfp[cfp].title,
          allCfp[cfp].number,
          allComments,
          await this.getMasterNodeList(),
        );
        resultsCfp.push(result);
      }
      return resultsCfp;
    } catch (e) {
      console.log(e);
      throw new ServiceUnavailableException('Failed to onboard chatbot for customer');
    }
  }

  private async getVotes(
    title: string,
    number: number,
    comments: CommentsResponse[],
    masterNodes: MasterNodeResponse[],
  ): Promise<CfpResult> {
    let yesVotes: number = 0;
    let neutralVotes: number = 0;
    let noVotes: number = 0;
    let votes: number = 0;

    for (const comment in comments) {
      let commentSplit = comments[comment].body
        .toString()
        .split('$ defi-cli ')
        .join('')
        .split('\r\n')
        .join(' ')
        .split('\n')
        .join(' ')
        .split('signmessage ');

      if (commentSplit.length > 1) {
        for (let a = 1; a < commentSplit.length; a++) {
          const address = commentSplit[a].split(' ')[0].split('"').join('');
          const vote = commentSplit[a].split(' ')[1].split('"').join('');
          const signature = commentSplit[a].split(' ')[2].split('"').join('');

          if (await this.verifyVote(address, signature, vote, masterNodes)) {
            switch (vote.split('-')[3]) {
              case 'yes': {
                yesVotes++;
                votes++;
                break;
              }
              case 'neutral': {
                neutralVotes++;
                votes++;
                break;
              }
              case 'no': {
                noVotes++;
                votes++;
                break;
              }
              default:
                break;
            }
          }
        }
      }
    }

    return {
      title: title,
      number: number,
      yes: yesVotes,
      neutral: neutralVotes,
      no: noVotes,
      votes: votes,
      possibleVotes: this.masterNodeVotesCounter,
      voteTurnout: Math.round((votes / this.masterNodeVotesCounter) * 100 * Math.pow(10, 2)) / Math.pow(10, 2),
      currentResult: yesVotes >= noVotes ? ResultStatus.APPROVED : ResultStatus.NOT_APPROVED,
    };
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

  private async getMasterNodeList(): Promise<MasterNodeResponse[]> {
    const masterNodes = await this.callApi<MasterNodeResponse[]>(this.masterNodeUrl, ``);
    this.masterNodeVotesCounter = 0;

    for (const key in masterNodes) {
      if (
        masterNodes[key].state === State.ENABLED &&
        masterNodes[key].mintedBlocks > 0 &&
        masterNodes[key].creationHeight < 1204845
      ) {
        this.masterNodeVotesCounter++;
      } else {
        delete masterNodes[key];
      }
    }

    return masterNodes;
  }
}
