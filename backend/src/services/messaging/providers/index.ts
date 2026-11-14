import { MessageChannel } from '@prisma/client';
import { MessagingProvider } from '../types';
import { arkeselSmsProvider } from './arkeselSmsProvider';
import { whatsappCloudProvider } from './whatsappCloudProvider';
import { emailProvider } from './emailProvider';

export function getProvider(channel: MessageChannel): MessagingProvider {
  switch (channel) {
    case MessageChannel.sms: return arkeselSmsProvider;
    case MessageChannel.whatsapp: return whatsappCloudProvider;
    case MessageChannel.email: return emailProvider;
    default: throw new Error(`No messaging provider for channel ${channel}`);
  }
}

export { arkeselSmsProvider, whatsappCloudProvider, emailProvider };
