import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';

export class BindEscalationChatDto {
  // explicit target group id (picked from the telegram-chats listing); when omitted the service
  // only auto-binds if exactly one group has explicitly invited the bot
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  chatId?: number;
}
