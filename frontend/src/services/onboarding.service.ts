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
  /** The North Star wizard (steps 3 to 6): the step the Owner reached and whether step 6 was finished. */
  northStar: { step: number; done: boolean };
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

  /** Save the step the Owner is on (3 to 6); `done` once step 6 is finished. */
  async saveNorthStarProgress(step: number, done = false): Promise<void> {
    await apiClient.post('/api/onboarding/north-star', { step, done });
  },

  async skipPartner(): Promise<void> {
    await apiClient.post('/api/onboarding/setup', { step: 2, skip: true });
  },
};
