import { InWalletTransaction } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { RoleGuard } from 'src/shared/auth/role.guard';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { HttpError } from 'src/shared/services/http.service';
import { CommandDto } from './dto/command.dto';
import { NodeMode, NodeService, NodeType } from './node.service';

@Controller('node')
export class NodeController {
  constructor(private readonly nodeService: NodeService) {}

  @Post(':node/:mode/rpc')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async rpc(@Param('node') node: NodeType, @Param('mode') mode: NodeMode, @Body() command: string): Promise<any> {
    return this.nodeService
      .getClient(node, mode)
      .sendRpcCommand(command)
      .catch((error: HttpError) => error.response?.data);
  }

  @Post(':node/:mode/cmd')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async cmd(@Param('node') node: NodeType, @Param('mode') mode: NodeMode, @Body() dto: CommandDto): Promise<any> {
    const client = this.nodeService.getClient(node, mode);
    try {
      return await client.sendCliCommand(dto.command, dto.noAutoUnlock);
    } catch (e) {
      throw new BadRequestException(`Command failed: ${e.message}`);
    }
  }

  @Get(':node/:mode/tx/:txId')
  @ApiBearerAuth()
  @ApiExcludeEndpoint()
  @UseGuards(AuthGuard(), new RoleGuard(UserRole.ADMIN))
  async waitForTx(@Param('node') node: NodeType, @Param('mode') mode: NodeMode, @Param('txId') txId: string): Promise<InWalletTransaction> {
    return this.nodeService.getClient(node, mode).waitForTx(txId);
  }
}
