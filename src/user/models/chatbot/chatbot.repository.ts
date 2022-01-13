import { EntityRepository, Repository } from 'typeorm';
import { Chatbot } from './Chatbot.entity';

@EntityRepository(Chatbot)
export class ChatbotRepository extends Repository<Chatbot> {}
