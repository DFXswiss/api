import { InWalletTransaction } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserActiveGuard } from 'src/shared/auth/user-active.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { HttpError } from 'src/shared/services/http.service';
import { BitcoinNodeType, BitcoinService } from './bitcoin.service';
import { CommandDto } from './dto/command.dto';

@Controller('node')
export class NodeController {
  constructor(private readonly bitcoinService: BitcoinService) {}

  @Post(':node/rpc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async rpc(@Param('node') node: BitcoinNodeType, @Body() command: string): Promise<any> {
    return this.bitcoinService
      .getDefaultClient(node)
      .sendRpcCommand(command)
      .catch((error: HttpError) => error.response?.data);
  }

  @Post(':node/cmd')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async cmd(@Param('node') node: BitcoinNodeType, @Body() dto: CommandDto): Promise<any> {
    const client = this.bitcoinService.getDefaultClient(node);

    try {
      return await client.sendCliCommand(dto.command, dto.noAutoUnlock);
    } catch (e) {
      throw new BadRequestException(`Command failed: ${e.message}`);
    }
  }

  @Get(':node/tx/:txId')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async waitForTx(@Param('node') node: BitcoinNodeType, @Param('txId') txId: string): Promise<InWalletTransaction> {
    return this.bitcoinService.getDefaultClient(node).waitForTx(txId);
  }

  @Post(':node/:mode/rpc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async rpcForMode(@Param('node') node: BitcoinNodeType, @Body() command: string): Promise<any> {
    return this.bitcoinService
      .getNodeFromPool(node)
      .sendRpcCommand(command)
      .catch((error: HttpError) => error.response?.data);
  }

  @Post(':node/:mode/cmd')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async cmdForMode(@Param('node') node: BitcoinNodeType, @Body() dto: CommandDto): Promise<any> {
    const client = this.bitcoinService.getNodeFromPool(node);

    try {
      return await client.sendCliCommand(dto.command, dto.noAutoUnlock);
    } catch (e) {
      throw new BadRequestException(`Command failed: ${e.message}`);
    }
  }

  @Get(':node/:mode/tx/:txId')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), RoleGuard(UserRole.ADMIN), UserActiveGuard())
  async waitForTxForMode(
    @Param('node') node: BitcoinNodeType,
    @Param('txId') txId: string,
  ): Promise<InWalletTransaction> {
    return this.bitcoinService.getNodeFromPool(node).waitForTx(txId);
  }
}
