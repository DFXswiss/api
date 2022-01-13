import { EntityRepository, Repository } from 'typeorm';
import { Chatbot } from './chatbot.entity';

@EntityRepository(Chatbot)
export class ChatbotRepository extends Repository<Chatbot> {}
