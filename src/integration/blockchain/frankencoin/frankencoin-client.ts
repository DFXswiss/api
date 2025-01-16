import { Contract } from 'ethers';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import FRANKENCOIN_EQUITY_ABI from '../shared/evm/abi/frankencoin-equity.abi.json';
import FRANKENCOIN_POSITION_ABI from '../shared/evm/abi/frankencoin-position.abi.json';
import FRANKENCOIN_STABLECOIN_BRIDGE_ABI from '../shared/evm/abi/frankencoin-stablecoin-bridge.abi.json';
import FRANKENCOIN_ABI from '../shared/evm/abi/frankencoin.abi.json';
import { EvmClient, EvmClientParams } from '../shared/evm/evm-client';
import {
  FrankencoinChallengeGraphDto,
  FrankencoinDelegationGraphDto,
  FrankencoinFpsGraphDto,
  FrankencoinMinterGraphDto,
  FrankencoinPositionGraphDto,
  FrankencoinTradeGraphDto,
} from './dto/frankencoin.dto';

export class FrankencoinClient extends EvmClient {
  constructor(params: EvmClientParams) {
    super(params);
  }

  async getPositionV1s(): Promise<FrankencoinPositionGraphDto[]> {
    const document = gql`
      {
        positionV1s {
          items {
            id
            position
            owner
            zchf
            collateral
            price
            collateralSymbol
            collateralBalance
            collateralDecimals
            limitForClones
            availableForClones
            minted
            reserveContribution
            expiration
            closed
            denied
          }
        }
      }
    `;

    return request<{ positionV1s: { items: [FrankencoinPositionGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.positionV1s.items);
  }

  async getPositionV2s(): Promise<FrankencoinPositionGraphDto[]> {
    const document = gql`
      {
        positionV2s {
          items {
            id
            position
            owner
            zchf
            collateral
            price
            collateralSymbol
            collateralBalance
            collateralDecimals
            limitForClones
            availableForClones
            minted
            reserveContribution
            expiration
            closed
            denied
          }
        }
      }
    `;

    return request<{ positionV2s: { items: [FrankencoinPositionGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.positionV2s.items);
  }

  async getChallengeV1s(): Promise<FrankencoinChallengeGraphDto[]> {
    const document = gql`
      {
        challengeV1s(orderBy: "status") {
          items {
            id
            challenger
            position
            start
            duration
            size
            filledSize
            acquiredCollateral
            number
            bid
            status
          }
        }
      }
    `;

    return request<{ challengeV1s: { items: [FrankencoinChallengeGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.challengeV1s.items);
  }

  async getChallengeV2s(): Promise<FrankencoinChallengeGraphDto[]> {
    const document = gql`
      {
        challengeV2s(orderBy: "status") {
          items {
            id
            challenger
            position
            start
            duration
            size
            filledSize
            acquiredCollateral
            number
            bid
            status
          }
        }
      }
    `;

    return request<{ challengeV2s: { items: [FrankencoinChallengeGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.challengeV2s.items);
  }

  async getFPS(zchfAddress: string): Promise<FrankencoinFpsGraphDto> {
    const document = gql`
      {
        fPS(id: "${zchfAddress}") {
          id
          profits
          loss
          reserve
        }
      }
    `;

    return request<{ fPS: FrankencoinFpsGraphDto }>(Config.blockchain.frankencoin.zchfGraphUrl, document).then(
      (r) => r.fPS,
    );
  }

  async getMinters(): Promise<FrankencoinMinterGraphDto[]> {
    const document = gql`
      {
        minters(orderBy: "applyDate", orderDirection: "desc") {
          items {
            id
            minter
            applicationPeriod
            applicationFee
            applyMessage
            applyDate
            suggestor
            denyMessage
            denyDate
            vetor
          }
        }
      }
    `;

    return request<{ minters: { items: [FrankencoinMinterGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.minters.items);
  }

  async getDelegation(owner: string): Promise<FrankencoinDelegationGraphDto> {
    const document = gql`
      {
        delegation(id: "${owner.toLowerCase()}") {
          id
          owner
          delegatedTo
          pureDelegatedFrom
        }
      }
    `;

    return request<{ delegation: FrankencoinDelegationGraphDto }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.delegation);
  }

  async getTrades(): Promise<FrankencoinTradeGraphDto[]> {
    const document = gql`
      {
        trades(orderDirection: "desc", orderBy: "time", limit: 100) {
          items {
            id
            trader
            amount
            shares
            price
            time
          }
        }
      }
    `;

    return request<{ trades: { items: [FrankencoinTradeGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.trades.items);
  }

  getErc20Contract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, ERC20_ABI, this.provider);
  }

  getFrankencoinContract(contractAddress: string): Contract {
    return new Contract(contractAddress, FRANKENCOIN_ABI, this.wallet);
  }

  getPositionContract(positionAddress: string): Contract {
    return new Contract(positionAddress, FRANKENCOIN_POSITION_ABI, this.provider);
  }

  getEquityContract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, FRANKENCOIN_EQUITY_ABI, this.wallet);
  }

  getStablecoinBridgeContract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, FRANKENCOIN_STABLECOIN_BRIDGE_ABI, this.provider);
  }
}
