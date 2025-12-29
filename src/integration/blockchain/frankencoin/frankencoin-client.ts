import { FPSWrapperABI } from '@frankencoin/zchf';
import { Contract } from 'ethers';
import { gql, request } from 'graphql-request';
import { Config } from 'src/config/config';
import ERC20_ABI from '../shared/evm/abi/erc20.abi.json';
import FRANKENCOIN_EQUITY_ABI from '../shared/evm/abi/frankencoin-equity.abi.json';
import FRANKENCOIN_POSITION_ABI from '../shared/evm/abi/frankencoin-position.abi.json';
import FRANKENCOIN_STABLECOIN_BRIDGE_ABI from '../shared/evm/abi/frankencoin-stablecoin-bridge.abi.json';
import FRANKENCOIN_ABI from '../shared/evm/abi/frankencoin.abi.json';
import { EvmClient } from '../shared/evm/evm-client';
import {
  FrankencoinChallengeGraphDto,
  FrankencoinFpsGraphDto,
  FrankencoinPositionGraphDto,
} from './dto/frankencoin.dto';

export class FrankencoinClient {
  constructor(private readonly evmClient: EvmClient) {}

  async getPositionV1s(): Promise<FrankencoinPositionGraphDto[]> {
    const document = gql`
      {
        mintingHubV1PositionV1s {
          items {
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

    return request<{ mintingHubV1PositionV1s: { items: [FrankencoinPositionGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.mintingHubV1PositionV1s.items);
  }

  async getPositionV2s(): Promise<FrankencoinPositionGraphDto[]> {
    const document = gql`
      {
        mintingHubV2PositionV2s {
          items {
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

    return request<{ mintingHubV2PositionV2s: { items: [FrankencoinPositionGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.mintingHubV2PositionV2s.items);
  }

  async getChallengeV1s(): Promise<FrankencoinChallengeGraphDto[]> {
    const document = gql`
      {
        mintingHubV1ChallengeV1s(orderBy: "status") {
          items {
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

    return request<{ mintingHubV1ChallengeV1s: { items: [FrankencoinChallengeGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.mintingHubV1ChallengeV1s.items);
  }

  async getChallengeV2s(): Promise<FrankencoinChallengeGraphDto[]> {
    const document = gql`
      {
        mintingHubV2ChallengeV2s(orderBy: "status") {
          items {
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

    return request<{ mintingHubV2ChallengeV2s: { items: [FrankencoinChallengeGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.mintingHubV2ChallengeV2s.items);
  }

  async getFPS(): Promise<FrankencoinFpsGraphDto> {
    const document = gql`
      {
        frankencoinProfitLosss(orderBy: "count", orderDirection: "DESC", limit: 1) {
          items {
            profits
            losses
          }
        }
      }
    `;

    return request<{ frankencoinProfitLosss: { items: [FrankencoinFpsGraphDto] } }>(
      Config.blockchain.frankencoin.zchfGraphUrl,
      document,
    ).then((r) => r.frankencoinProfitLosss.items[0]);
  }

  get walletAddress(): string {
    return this.evmClient.wallet.address;
  }

  getErc20Contract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, ERC20_ABI, this.evmClient.wallet);
  }

  getFrankencoinContract(contractAddress: string): Contract {
    return new Contract(contractAddress, FRANKENCOIN_ABI, this.evmClient.wallet);
  }

  getPositionContract(positionAddress: string): Contract {
    return new Contract(positionAddress, FRANKENCOIN_POSITION_ABI, this.evmClient.wallet);
  }

  getEquityContract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, FRANKENCOIN_EQUITY_ABI, this.evmClient.wallet);
  }

  getFPSWrapperContract(wrapperAddress: string): Contract {
    return new Contract(wrapperAddress, FPSWrapperABI, this.evmClient.wallet);
  }

  getStablecoinBridgeContract(collateralAddress: string): Contract {
    return new Contract(collateralAddress, FRANKENCOIN_STABLECOIN_BRIDGE_ABI, this.evmClient.wallet);
  }
}
