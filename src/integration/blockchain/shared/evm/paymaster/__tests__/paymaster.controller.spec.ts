import { Test, TestingModule } from '@nestjs/testing';
import { PaymasterController } from '../paymaster.controller';
import { PaymasterService } from '../paymaster.service';
import { PaymasterRpcRequest, PaymasterRpcResponse } from '../dto/paymaster.dto';

describe('PaymasterController', () => {
  let controller: PaymasterController;
  let paymasterService: jest.Mocked<PaymasterService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymasterController],
      providers: [
        {
          provide: PaymasterService,
          useValue: {
            handleRpcRequest: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PaymasterController>(PaymasterController);
    paymasterService = module.get(PaymasterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handlePaymasterRequest', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should call paymasterService.handleRpcRequest with chainId and request', async () => {
      const chainId = 1;
      const request: PaymasterRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'pm_getPaymasterStubData',
        params: [{ sender: '0xUser', nonce: '0x0', callData: '0x' }, '0xEntryPoint', {}],
      };

      const expectedResponse: PaymasterRpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          paymaster: '0xPaymaster',
          paymasterData: '0x',
          paymasterVerificationGasLimit: '0x30000',
          paymasterPostOpGasLimit: '0x10000',
          isFinal: false,
        },
      };

      paymasterService.handleRpcRequest.mockResolvedValue(expectedResponse);

      const result = await controller.handlePaymasterRequest(chainId, request);

      expect(paymasterService.handleRpcRequest).toHaveBeenCalledWith(chainId, request);
      expect(result).toEqual(expectedResponse);
    });

    it('should pass through pm_getPaymasterStubData request', async () => {
      const request: PaymasterRpcRequest = {
        jsonrpc: '2.0',
        id: 42,
        method: 'pm_getPaymasterStubData',
        params: [
          { sender: '0xSender', nonce: '0x1', callData: '0xa9059cbb...' },
          '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
          { context: 'test' },
        ],
      };

      await controller.handlePaymasterRequest(1, request);

      expect(paymasterService.handleRpcRequest).toHaveBeenCalledWith(1, request);
    });

    it('should pass through pm_getPaymasterData request', async () => {
      const request: PaymasterRpcRequest = {
        jsonrpc: '2.0',
        id: 123,
        method: 'pm_getPaymasterData',
        params: [
          { sender: '0xSender', nonce: '0x5', callData: '0xa9059cbb...' },
          '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
          {},
        ],
      };

      const expectedResponse: PaymasterRpcResponse = {
        jsonrpc: '2.0',
        id: 123,
        result: {
          paymaster: '0xPaymaster',
          paymasterData: '0x000001234567890abcdef...',
        },
      };

      paymasterService.handleRpcRequest.mockResolvedValue(expectedResponse);

      const result = await controller.handlePaymasterRequest(42161, request);

      expect(paymasterService.handleRpcRequest).toHaveBeenCalledWith(42161, request);
      expect(result).toEqual(expectedResponse);
    });

    it('should return error response from service', async () => {
      const request: PaymasterRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'pm_getPaymasterStubData',
        params: [{ sender: '0xUser', nonce: '0x0', callData: '0x' }, '0xEntryPoint', {}],
      };

      const errorResponse: PaymasterRpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32000,
          message: 'Only transfers to DFX deposit addresses are sponsored',
        },
      };

      paymasterService.handleRpcRequest.mockResolvedValue(errorResponse);

      const result = await controller.handlePaymasterRequest(1, request);

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe(-32000);
    });

    it('should handle different chain IDs', async () => {
      const request: PaymasterRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'pm_getPaymasterStubData',
        params: [],
      };

      paymasterService.handleRpcRequest.mockResolvedValue({
        jsonrpc: '2.0',
        id: 1,
        result: { paymaster: '0x' },
      });

      // Test various chain IDs
      const chainIds = [1, 42161, 10, 137, 8453, 56, 100, 11155111];

      for (const chainId of chainIds) {
        await controller.handlePaymasterRequest(chainId, request);
        expect(paymasterService.handleRpcRequest).toHaveBeenLastCalledWith(chainId, request);
      }

      expect(paymasterService.handleRpcRequest).toHaveBeenCalledTimes(chainIds.length);
    });

    it('should preserve request id in response', async () => {
      const requestIds = [1, 42, 999, 0];

      for (const id of requestIds) {
        const request: PaymasterRpcRequest = {
          jsonrpc: '2.0',
          id,
          method: 'pm_getPaymasterStubData',
          params: [],
        };

        paymasterService.handleRpcRequest.mockResolvedValue({
          jsonrpc: '2.0',
          id,
          result: { paymaster: '0x' },
        });

        const result = await controller.handlePaymasterRequest(1, request);
        expect(result.id).toBe(id);
      }
    });

    it('should return method not found error for unknown methods', async () => {
      const request: PaymasterRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'unknown_method' as any,
        params: [],
      };

      const errorResponse: PaymasterRpcResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32601,
          message: 'Method not found: unknown_method',
        },
      };

      paymasterService.handleRpcRequest.mockResolvedValue(errorResponse);

      const result = await controller.handlePaymasterRequest(1, request);

      expect(result.error?.code).toBe(-32601);
    });
  });
});
