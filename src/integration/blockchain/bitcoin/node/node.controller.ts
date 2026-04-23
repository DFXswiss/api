import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { HttpError } from 'src/shared/services/http.service';
import { BitcoinService } from '../services/bitcoin.service';
import { CommandDto } from './dto/command.dto';
import { InWalletTransaction } from './node-client';

@Controller('node')
export class NodeController {
  constructor(private readonly bitcoinService: BitcoinService) {}

  @Post('rpc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async rpc(@Body() command: string): Promise<any> {
    return this.bitcoinService
      .getDefaultClient()
      .sendRpcCommand(command)
      .catch((error: HttpError) => error.response?.data);
  }

  @Post('cmd')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async cmd(@Body() dto: CommandDto): Promise<any> {
    const client = this.bitcoinService.getDefaultClient();

    try {
      return await client.sendCliCommand(dto.command, dto.noAutoUnlock);
    } catch (e) {
      throw new BadRequestException(`Command failed: ${e.message}`);
    }
  }

  @Get('tx/:txId')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async waitForTx(@Param('txId') txId: string): Promise<InWalletTransaction> {
    return this.bitcoinService.getDefaultClient().waitForTx(txId);
  }
}
