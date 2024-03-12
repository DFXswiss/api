import { BankTx } from '../bank-tx.entity';

describe('BankTx', () => {
  const multiAccountIban = 'MULTI-ACCOUNT-IBAN';

  describe('#senderAccount(...)', () => {
    it('should return the IBAN', () => {
      const entity = Object.assign(new BankTx(), { iban: 'RANDOM-IBAN' });

      const sender = entity.senderAccount([multiAccountIban]);

      expect(sender).toBe('RANDOM-IBAN');
    });

    it('should add the name, if multi-account IBAN', () => {
      const entity = Object.assign(new BankTx(), { iban: multiAccountIban, name: 'John Doe' });

      const sender = entity.senderAccount([multiAccountIban]);

      expect(sender).toBe(`${multiAccountIban};JohnDoe`);
    });

    it('should add the name and ultimate name, if multi-account IBAN', () => {
      const entity = Object.assign(new BankTx(), { iban: multiAccountIban, name: 'John Doe', ultimateName: 'Doe' });

      const sender = entity.senderAccount([multiAccountIban]);

      expect(sender).toBe(`${multiAccountIban};JohnDoeDoe`);
    });

    it('should return NOIBAN for account numbers', () => {
      const entity = Object.assign(new BankTx(), { iban: '2345' });

      const sender = entity.senderAccount([multiAccountIban]);

      expect(sender).toBe('NOIBAN2345');
    });

    it('should use IBAN from name', () => {
      const entity = Object.assign(new BankTx(), { name: '/C/RANDOM-IBAN' });

      const sender = entity.senderAccount([multiAccountIban]);

      expect(sender).toBe('RANDOM-IBAN');
    });

    it('should use Schaltereinzahlung', () => {
      const entity = Object.assign(new BankTx(), { name: 'Schaltereinzahlung' });

      const sender = entity.senderAccount([multiAccountIban]);

      expect(sender).toBe('Schaltereinzahlung');
    });

    it('should use the name, if no IBAN', () => {
      const entity = Object.assign(new BankTx(), { name: 'John Doe ' });

      const sender = entity.senderAccount([multiAccountIban]);

      expect(sender).toBe('John:Doe');
    });

    it('should use the name and ultimate name, if no IBAN', () => {
      const entity = Object.assign(new BankTx(), { name: 'John Doe ', ultimateName: ' Doe ' });

      const sender = entity.senderAccount([multiAccountIban]);

      expect(sender).toBe('John:Doe:Doe');
    });
  });
});
