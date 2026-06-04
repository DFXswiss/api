import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsString, Matches, Min } from 'class-validator';
import { GetConfig } from 'src/config/config';
import { Eip7702ConfirmDto } from 'src/subdomains/core/sell-crypto/route/dto/eip7702-delegation.dto';

// --- W2W TRANSFER --- //

// --- Request DTOs ---

export class RealUnitTransferDto {
  @ApiProperty({ description: 'Recipient wallet address (EVM)' })
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  toAddress: string;

  @ApiProperty({ description: 'Amount of REALU shares to transfer (whole shares, REALU decimals = 0)' })
  @IsNotEmpty()
  @IsNumber()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  amount: number;
}

export class RealUnitTransferConfirmDto extends Eip7702ConfirmDto {}

// --- EIP-7702 Data DTO ---

// EIP-712 caveat entry (matches the DelegationManager `Caveat` struct: enforcer + terms). The
// RealUnit blanket delegation carries no caveats, but the shape is typed precisely so no `any`
// leaks into the signed payload the app receives.
export class Eip712CaveatDto {
  @ApiProperty({ description: 'Caveat enforcer contract address' })
  enforcer: string;

  @ApiProperty({ description: 'Caveat terms (ABI-encoded bytes)' })
  terms: string;
}

export class RealUnitTransferEip7702DataDto {
  @ApiProperty({ description: 'Relayer address that will execute the transaction (W2W gas wallet)' })
  relayerAddress: string;

  @ApiProperty({ description: 'DelegationManager contract address' })
  delegationManagerAddress: string;

  @ApiProperty({ description: 'Delegator contract address' })
  delegatorAddress: string;

  @ApiProperty({ description: 'User account nonce for EIP-7702 authorization' })
  userNonce: number;

  @ApiProperty({ description: 'EIP-712 domain for delegation signature' })
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };

  @ApiProperty({ description: 'EIP-712 types for delegation signature' })
  types: {
    Delegation: Array<{ name: string; type: string }>;
    Caveat: Array<{ name: string; type: string }>;
  };

  @ApiProperty({ description: 'Delegation message to sign' })
  message: {
    delegate: string;
    delegator: string;
    authority: string;
    caveats: Eip712CaveatDto[];
    salt: number;
  };

  @ApiProperty({ description: 'REALU token contract address' })
  tokenAddress: string;

  @ApiProperty({ description: 'Amount in wei (token smallest unit)' })
  amountWei: string;

  @ApiProperty({ description: 'Recipient address (where the REALU shares will be sent)' })
  recipient: string;
}

// --- Response DTO ---

export class RealUnitTransferPaymentInfoDto {
  @ApiProperty({ description: 'Transfer request ID (use for the confirm endpoint)' })
  id: number;

  @ApiProperty({ description: 'Transfer request UID' })
  uid: string;

  @ApiProperty({ description: 'Recipient wallet address (checksum-normalized)' })
  toAddress: string;

  @ApiProperty({ description: 'Amount of REALU shares to transfer' })
  amount: number;

  @ApiProperty({ description: 'REALU token contract address' })
  tokenAddress: string;

  @ApiProperty({ description: 'EVM chain ID' })
  chainId: number;

  @ApiProperty({ type: RealUnitTransferEip7702DataDto, description: 'EIP-7702 delegation data for gasless transfer' })
  eip7702: RealUnitTransferEip7702DataDto;
}
