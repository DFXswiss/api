import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmDto, GaslessDto, GaslessSignatureDto, PermitDto } from '../dto/confirm.dto';

describe('ConfirmDto', () => {
  describe('GaslessSignatureDto validation', () => {
    it('should validate correct signature', async () => {
      const dto = plainToInstance(GaslessSignatureDto, {
        v: 27,
        r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should validate v=28', async () => {
      const dto = plainToInstance(GaslessSignatureDto, {
        v: 28,
        r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject invalid r format (wrong length)', async () => {
      const dto = plainToInstance(GaslessSignatureDto, {
        v: 27,
        r: '0x1234', // Too short
        s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'r')).toBe(true);
    });

    it('should reject invalid s format (wrong length)', async () => {
      const dto = plainToInstance(GaslessSignatureDto, {
        v: 27,
        r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        s: '0xabcdef', // Too short
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 's')).toBe(true);
    });

    it('should reject r without 0x prefix', async () => {
      const dto = plainToInstance(GaslessSignatureDto, {
        v: 27,
        r: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject missing v', async () => {
      const dto = plainToInstance(GaslessSignatureDto, {
        r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'v')).toBe(true);
    });
  });

  describe('GaslessDto validation', () => {
    const validGaslessDto = {
      userAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      amount: '1000000000000000000',
      recipient: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      deadline: Math.floor(Date.now() / 1000) + 3600,
      signature: {
        v: 27,
        r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      },
    };

    it('should validate correct gasless dto', async () => {
      const dto = plainToInstance(GaslessDto, validGaslessDto);

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject invalid userAddress format', async () => {
      const dto = plainToInstance(GaslessDto, {
        ...validGaslessDto,
        userAddress: 'invalid-address',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'userAddress')).toBe(true);
    });

    it('should reject invalid tokenAddress format', async () => {
      const dto = plainToInstance(GaslessDto, {
        ...validGaslessDto,
        tokenAddress: '0x123', // Too short
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'tokenAddress')).toBe(true);
    });

    it('should reject empty amount', async () => {
      const dto = plainToInstance(GaslessDto, {
        ...validGaslessDto,
        amount: '',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'amount')).toBe(true);
    });

    it('should reject missing deadline', async () => {
      const { deadline, ...dtoWithoutDeadline } = validGaslessDto;
      const dto = plainToInstance(GaslessDto, dtoWithoutDeadline);

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'deadline')).toBe(true);
    });

    it('should reject missing signature', async () => {
      const { signature, ...dtoWithoutSignature } = validGaslessDto;
      const dto = plainToInstance(GaslessDto, dtoWithoutSignature);

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'signature')).toBe(true);
    });

    it('should validate nested signature object', async () => {
      const dto = plainToInstance(GaslessDto, {
        ...validGaslessDto,
        signature: {
          v: 27,
          r: '0x123', // Invalid
          s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        },
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('ConfirmDto options', () => {
    const validPermit: PermitDto = {
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      signature: '0x' + 'ab'.repeat(65),
      signatureTransferContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      permittedAmount: 1000000,
      executorAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      nonce: 1,
      deadline: '1703376000',
    };

    const validGasless: GaslessDto = {
      userAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      amount: '1000000000000000000',
      recipient: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      deadline: Math.floor(Date.now() / 1000) + 3600,
      signature: {
        v: 27,
        r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        s: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      },
    };

    const validSignedTxHex = '0xf86c0a8502540be40082520894' + 'ab'.repeat(20) + '880de0b6b3a764000080';

    it('should accept only permit', async () => {
      const dto = plainToInstance(ConfirmDto, { permit: validPermit });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept only gasless', async () => {
      const dto = plainToInstance(ConfirmDto, { gasless: validGasless });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept only signedTxHex', async () => {
      const dto = plainToInstance(ConfirmDto, { signedTxHex: validSignedTxHex });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept empty dto (validation at service level)', async () => {
      // ConfirmDto allows all optional - business logic validates XOR
      const dto = plainToInstance(ConfirmDto, {});

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept permit and gasless together (XOR at service level)', async () => {
      // DTO validation passes, but service should reject
      const dto = plainToInstance(ConfirmDto, {
        permit: validPermit,
        gasless: validGasless,
      });

      // DTO validation is permissive - service handles XOR logic
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
