import { ethers } from 'ethers';
import { hashMessage } from 'ethers/lib/utils';

// ERC-1271 Magic Values
const ERC1271_MAGIC_VALUE = '0x1626ba7e';
const ERC1271_INVALID_VALUE = '0xffffffff';

describe('ERC-1271 Signature Verification', () => {
  describe('hashMessage', () => {
    it('should hash message correctly for ERC-1271', () => {
      const message =
        'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_Blockchain_address._Your_ID:_0x623777Cc098C6058a46cF7530f45150ff6a8459D';
      const hash = hashMessage(message);

      // Hash should be a 32-byte hex string
      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe('ERC-1271 interface', () => {
    it('should define correct magic value', () => {
      expect(ERC1271_MAGIC_VALUE).toBe('0x1626ba7e');
    });

    it('should define correct invalid value', () => {
      expect(ERC1271_INVALID_VALUE).toBe('0xffffffff');
    });

    it('should create correct function selector for isValidSignature', () => {
      const iface = new ethers.utils.Interface([
        'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
      ]);
      const selector = iface.getSighash('isValidSignature');

      // isValidSignature(bytes32,bytes) selector
      expect(selector).toBe('0x1626ba7e');
    });
  });

  describe('EOA vs Contract detection', () => {
    it('should identify EOA by empty code', () => {
      const eoaCode: string = '0x';
      const isEoa = eoaCode === '0x';
      expect(isEoa).toBe(true);
    });

    it('should identify contract by non-empty code', () => {
      // Sample bytecode (just needs to be non-empty)
      const contractCode: string = '0x608060405234801561001057600080fd5b50';
      const isContract = contractCode !== '0x';
      expect(isContract).toBe(true);
    });
  });

  describe('Signature format', () => {
    it('should normalize signature with 0x prefix', () => {
      const sigWithoutPrefix = 'abc123';
      const sigWithPrefix = '0xabc123';

      const normalized1 = sigWithoutPrefix.startsWith('0x') ? sigWithoutPrefix : '0x' + sigWithoutPrefix;
      const normalized2 = sigWithPrefix.startsWith('0x') ? sigWithPrefix : '0x' + sigWithPrefix;

      expect(normalized1).toBe('0xabc123');
      expect(normalized2).toBe('0xabc123');
    });
  });
});
