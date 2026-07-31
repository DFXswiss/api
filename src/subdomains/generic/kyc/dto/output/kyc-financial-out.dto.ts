import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuestionType } from '../../enums/kyc.enum';
import { KycFinancialInData } from '../input/kyc-financial-in.dto';

export class KycFinancialOption {
  @ApiProperty({ description: 'Option key' })
  key: string;

  @ApiProperty({ description: 'Option text (translated)' })
  text: string;
}

export class KycFinancialCondition {
  @ApiProperty({ description: 'Key of the prerequisite question that must be answered first.' })
  question: string;

  @ApiProperty({ description: 'Answer value of the prerequisite question that activates this question.' })
  response: string;
}

export class KycFinancialQuestion {
  @ApiProperty({ description: 'Question key' })
  key: string;

  @ApiProperty({ description: 'Question type', enum: QuestionType })
  type: QuestionType;

  @ApiProperty({ description: 'Question title (translated)' })
  title: string;

  @ApiProperty({ description: 'Question description (translated)' })
  description: string;

  @ApiPropertyOptional({ description: 'Response options', type: KycFinancialOption, isArray: true })
  options?: KycFinancialOption[];

  @ApiPropertyOptional({
    description: 'Preconditions under which this question applies. Omitted when the question is always applicable.',
    type: KycFinancialCondition,
    isArray: true,
  })
  conditions?: KycFinancialCondition[];
}

export class KycFinancialOutData extends KycFinancialInData {
  @ApiProperty({ type: KycFinancialQuestion, isArray: true })
  questions: KycFinancialQuestion[];
}
