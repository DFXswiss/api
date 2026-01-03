import { Controller, Post, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiOkResponse } from '@nestjs/swagger';
import { PaymasterService } from './paymaster.service';
import { PaymasterRpcRequest, PaymasterRpcResponse } from './dto/paymaster.dto';

@ApiTags('Paymaster')
@Controller('paymaster')
export class PaymasterController {
  constructor(private readonly paymasterService: PaymasterService) {}

  @Post(':chainId')
  @ApiOperation({
    summary: 'ERC-7677 Paymaster RPC endpoint',
    description: 'Handles pm_getPaymasterStubData and pm_getPaymasterData requests for gas sponsorship',
  })
  @ApiParam({
    name: 'chainId',
    description: 'Chain ID (e.g., 1 for Ethereum, 137 for Polygon)',
    example: 1,
  })
  @ApiBody({ type: PaymasterRpcRequest })
  @ApiOkResponse({ type: PaymasterRpcResponse })
  async handlePaymasterRequest(
    @Param('chainId', ParseIntPipe) chainId: number,
    @Body() request: PaymasterRpcRequest,
  ): Promise<PaymasterRpcResponse> {
    return this.paymasterService.handleRpcRequest(chainId, request);
  }
}
