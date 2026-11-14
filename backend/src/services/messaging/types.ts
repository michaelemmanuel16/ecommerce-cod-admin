import { MessageChannel, MessageStatus } from '@prisma/client';

/** The part of an Express request a provider adapter reads. */
export interface CallbackRequest {
  body?: any;
  headers?: Record<string, any>;
  query?: Record<string, any>;
}

export interface TemplateSend {
  name: string;
  languageCode?: string;
  bodyParams?: string[];
  headerParams?: string[];
  buttonPayloads?: string[];
}

/** What a provider adapter gets. The phone is already formatted for the channel. */
export interface ProviderSendInput {
  tenantId: string | null;
  to: string;
  body?: string;
  template?: TemplateSend;
  // Email only
  subject?: string;
  /** Full From header; overrides the sender identity the adapter builds. */
  from?: string;
  headers?: Record<string, string>;
  /** 'platform' = CodAdmin's own sender; 'tenant' = the tenant's own provider. Default 'tenant'. */
  sendAs?: 'platform' | 'tenant';
}

export interface ProviderSendResult {
  providerMessageId?: string;
  accepted: boolean;
  error?: string;
  /** The provider that really sent (email picks resend, smtp or sendgrid per tenant). */
  provider?: string;
}

/** One delivery event from a provider callback. */
export interface ParsedStatus {
  providerMessageId: string;
  status: MessageStatus;
  occurredAt: Date;
  /** The provider's own status word */
  providerStatus?: string;
  /** Short readable text, mapped from the provider's failure code */
  failureReason?: string;
  payload?: unknown;
}

export interface ParsedInbound {
  providerMessageId?: string;
  from: string;
  type: string;
  text: string;
  buttonPayload?: string | null;
  /** Id of the outbound message this answers */
  contextMessageId?: string | null;
  occurredAt: Date;
  raw: unknown;
}

export interface MessagingProvider {
  channel: MessageChannel;
  /** Stored on MessageLog.provider: arkesel | whatsapp_cloud | resend | smtp */
  name: string;
  isEnabled(tenantId: string | null, opts?: { sendAs?: 'platform' | 'tenant' }): Promise<boolean>;
  /** Never throws: a refusal comes back as accepted: false with an error text. */
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
  parseStatusCallback(req: CallbackRequest): ParsedStatus[];
  parseInbound?(req: CallbackRequest): ParsedInbound[];
}
