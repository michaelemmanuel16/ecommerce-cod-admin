import apiClient from './api';

export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
  tenantId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplateInput {
  name: string;
  subject: string;
  body: string;
}

const BASE = '/api/communications/email-templates';

export const emailTemplateService = {
  async list(): Promise<EmailTemplate[]> {
    const res = await apiClient.get(BASE);
    return res.data;
  },

  async create(data: EmailTemplateInput): Promise<EmailTemplate> {
    const res = await apiClient.post(BASE, data);
    return res.data;
  },

  async update(id: number, data: Partial<EmailTemplateInput>): Promise<EmailTemplate> {
    const res = await apiClient.put(`${BASE}/${id}`, data);
    return res.data;
  },

  async remove(id: number): Promise<void> {
    await apiClient.delete(`${BASE}/${id}`);
  },
};
