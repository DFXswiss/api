import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, ValidateNested } from 'class-validator';
import { GetConfig } from 'src/config/config';

/**
 * EIP-712 Delegation signature from user
 * User delegates permission to relayer to execute token transfer on their behalf
 */
export class Eip7702DelegationDto {
  @ApiProperty({ description: 'Relayer address (delegate)' })
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  delegate: string;

  @ApiProperty({ description: 'User address (delegator)' })
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  delegator: string;

  @ApiProperty({ description: 'Authority hash (ROOT_AUTHORITY for full permissions)' })
  @IsNotEmpty()
  @IsString()
  authority: string;

  @ApiProperty({ description: 'Salt for delegation uniqueness' })
  @IsNotEmpty()
  @IsString()
  salt: string;

  @ApiProperty({ description: 'EIP-712 signature of the delegation' })
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.signature)
  signature: string;
}

/**
 * EIP-7702 Authorization from user
 * User authorizes their EOA to become a delegator contract
 */
export class Eip7702AuthorizationDto {
  @ApiProperty({ description: 'Chain ID' })
  @IsNotEmpty()
  chainId: number | string;

  @ApiProperty({ description: 'Delegator contract address' })
  @IsNotEmpty()
  @IsString()
  @Matches(GetConfig().formats.address)
  address: string;

  @ApiProperty({ description: 'Nonce for authorization' })
  @IsNotEmpty()
  nonce: number | string;

  @ApiProperty({ description: 'R component of authorization signature' })
  @IsNotEmpty()
  @IsString()
  r: string;

  @ApiProperty({ description: 'S component of authorization signature' })
  @IsNotEmpty()
  @IsString()
  s: string;

  @ApiProperty({ description: 'Y parity of authorization signature (0 or 1)' })
  @IsNotEmpty()
  yParity: number;
}

/**
 * Complete EIP-7702 delegation data from frontend
 */
export class Eip7702ConfirmDto {
  @ApiProperty({ type: Eip7702DelegationDto, description: 'Delegation signature' })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => Eip7702DelegationDto)
  delegation: Eip7702DelegationDto;

  @ApiProperty({ type: Eip7702AuthorizationDto, description: 'EIP-7702 authorization' })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => Eip7702AuthorizationDto)
  authorization: Eip7702AuthorizationDto;
}
