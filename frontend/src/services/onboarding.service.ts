import { apiClient } from './api';

export interface OnboardingStep {
  step: number;
  key: string;
  done: boolean;
  skipped?: boolean;
}

export interface OnboardingStatus {
  onboardingCompleted: boolean;
  country: string | null;
  currency: string | null;
  steps: OnboardingStep[];
}

export interface StoreInput {
  businessName: string;
  country: string;
  currency: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
  taxId?: string;
}

export interface PartnerInput {
  name: string;
  type: '3pl' | 'agent';
  email: string;
  phone?: string;
}

/** The first-run wizard API (F-124): step 1 "Your store", step 2 "Connect your 3PL", and the done state of each step. */
export const onboardingService = {
  async getStatus(): Promise<OnboardingStatus> {
    const { data } = await apiClient.get<OnboardingStatus>('/api/onboarding/status', { skipCache: true });
    return data;
  },

  async saveStore(input: StoreInput): Promise<void> {
    await apiClient.post('/api/onboarding/setup', { step: 1, ...input });
  },

  async addPartner(input: PartnerInput): Promise<void> {
    await apiClient.post('/api/onboarding/setup', { step: 2, ...input });
  },

  async skipPartner(): Promise<void> {
    await apiClient.post('/api/onboarding/setup', { step: 2, skip: true });
  },
};
