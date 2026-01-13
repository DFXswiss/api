import { plainToInstance } from 'class-transformer';
import { CreateBankDataDto } from '../create-bank-data.dto';
import { UpdateBankDataDto } from '../update-bank-data.dto';

describe('BankDataDto', () => {
  describe('CreateBankDataDto', () => {
    describe('name transform', () => {
      it('should keep valid name unchanged', () => {
        const dto = plainToInstance(CreateBankDataDto, { iban: 'CH123', name: 'Max Mustermann' });
        expect(dto.name).toBe('Max Mustermann');
      });

      it('should trim whitespace from name', () => {
        const dto = plainToInstance(CreateBankDataDto, { iban: 'CH123', name: '  Max Mustermann  ' });
        expect(dto.name).toBe('Max Mustermann');
      });

      it('should transform empty string to null', () => {
        const dto = plainToInstance(CreateBankDataDto, { iban: 'CH123', name: '' });
        expect(dto.name).toBeUndefined();
      });

      it('should transform whitespace-only string to null', () => {
        const dto = plainToInstance(CreateBankDataDto, { iban: 'CH123', name: '   ' });
        expect(dto.name).toBeUndefined();
      });

      it('should transform undefined to null', () => {
        const dto = plainToInstance(CreateBankDataDto, { iban: 'CH123', name: undefined });
        expect(dto.name).toBeUndefined();
      });

      it('should transform null to null', () => {
        const dto = plainToInstance(CreateBankDataDto, { iban: 'CH123', name: null });
        expect(dto.name).toBeUndefined();
      });
    });
  });

  describe('UpdateBankDataDto', () => {
    describe('name transform', () => {
      it('should keep valid name unchanged', () => {
        const dto = plainToInstance(UpdateBankDataDto, { name: 'Max Mustermann' });
        expect(dto.name).toBe('Max Mustermann');
      });

      it('should trim whitespace from name', () => {
        const dto = plainToInstance(UpdateBankDataDto, { name: '  Max Mustermann  ' });
        expect(dto.name).toBe('Max Mustermann');
      });

      it('should transform empty string to null', () => {
        const dto = plainToInstance(UpdateBankDataDto, { name: '' });
        expect(dto.name).toBeUndefined();
      });

      it('should transform whitespace-only string to null', () => {
        const dto = plainToInstance(UpdateBankDataDto, { name: '   ' });
        expect(dto.name).toBeUndefined();
      });

      it('should transform undefined to null', () => {
        const dto = plainToInstance(UpdateBankDataDto, { name: undefined });
        expect(dto.name).toBeUndefined();
      });

      it('should transform null to null', () => {
        const dto = plainToInstance(UpdateBankDataDto, { name: null });
        expect(dto.name).toBeUndefined();
      });
    });
  });
});
