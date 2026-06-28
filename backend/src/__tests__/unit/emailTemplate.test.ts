import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { tenantStorage } from '../../utils/tenantContext';
import {
  renderEmailTemplate,
  sanitizeEmailHtml,
  seedDefaultEmailTemplates,
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_MERGE_TAGS,
} from '../../services/emailTemplateService';
import { communicationService } from '../../services/communicationService';

describe('EmailTemplate rendering + sanitization (MAN-78)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('renderEmailTemplate — merge tags', () => {
    const context = {
      customer_name: 'Ama Boateng',
      customer_email: 'ama@example.com',
      store_name: 'Spur Shop',
      order_number: 'ORD-1042',
      order_total: 'GHS 240',
      download_url: 'https://dl.example.com/abc',
    };

    it('substitutes all six merge tags in subject and body', () => {
      const template = {
        subject: '{{store_name}}: order {{order_number}}',
        body: '<p>Hi {{customer_name}} ({{customer_email}}), total {{order_total}}. <a href="{{download_url}}">Download</a></p>',
      };
      const { subject, html } = renderEmailTemplate(template, context);

      expect(subject).toBe('Spur Shop: order ORD-1042');
      expect(html).toContain('Hi Ama Boateng');
      expect(html).toContain('ama@example.com');
      expect(html).toContain('GHS 240');
      // No unresolved known tags remain.
      for (const tag of EMAIL_MERGE_TAGS) {
        expect(html).not.toContain(`{{${tag}}}`);
        expect(subject).not.toContain(`{{${tag}}}`);
      }
    });

    it('HTML-escapes every merge value (no injection through a tag)', () => {
      const { html } = renderEmailTemplate(
        { subject: 's', body: '<p>{{customer_name}}</p>' },
        { customer_name: '<script>alert(1)</script>' },
      );
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('renders missing tags as empty, leaves unknown tokens untouched', () => {
      const { subject, html } = renderEmailTemplate(
        { subject: 'Hi {{customer_name}} {{unknown_tag}}', body: '<p>{{order_total}}</p>' },
        {},
      );
      expect(subject).toBe('Hi  {{unknown_tag}}');
      expect(html).toBe('<p></p>');
    });
  });

  describe('sanitizeEmailHtml — allowlist on save (H3)', () => {
    it('strips <script> but keeps safe formatting + links', () => {
      const dirty = '<p>Hello</p><script>steal()</script><a href="https://x.com">link</a>';
      const clean = sanitizeEmailHtml(dirty);
      expect(clean).not.toContain('<script>');
      expect(clean).not.toContain('steal()');
      expect(clean).toContain('<p>Hello</p>');
      expect(clean).toContain('href="https://x.com"');
    });

    it('drops event-handler attributes and javascript: URLs', () => {
      const dirty = '<a href="javascript:alert(1)" onclick="evil()">x</a>';
      const clean = sanitizeEmailHtml(dirty);
      expect(clean).not.toContain('onclick');
      expect(clean).not.toContain('javascript:');
    });
  });

  describe('communicationService.createEmailTemplate — sanitizes on save', () => {
    it('persists a sanitized body (no <script>)', async () => {
      (prismaMock.emailTemplate.create as any).mockImplementation((args: any) =>
        Promise.resolve({ id: 1, ...args.data }),
      );

      await communicationService.createEmailTemplate({
        name: 'Promo',
        subject: 'Hi',
        body: '<p>ok</p><script>bad()</script>',
      });

      const createArg = (prismaMock.emailTemplate.create as any).mock.calls[0][0];
      expect(createArg.data.body).not.toContain('<script>');
      expect(createArg.data.body).toContain('<p>ok</p>');
    });
  });

  describe('seedDefaultEmailTemplates — idempotent per-tenant seed', () => {
    it('createMany with the 3 defaults + skipDuplicates, inside tenant context', async () => {
      (prismaMock.emailTemplate.createMany as any).mockResolvedValue({ count: 3 });

      const count = await seedDefaultEmailTemplates('tenant-x');
      expect(count).toBe(3);

      const arg = (prismaMock.emailTemplate.createMany as any).mock.calls[0][0];
      expect(arg.skipDuplicates).toBe(true);
      expect(arg.data).toHaveLength(DEFAULT_EMAIL_TEMPLATES.length);
      // Bodies are sanitized at seed time too.
      for (const row of arg.data) {
        expect(row.body).not.toContain('<script>');
      }
    });

    it('runs the seed within tenant context (so the extension can stamp tenantId)', async () => {
      let tenantSeen: string | null = null;
      (prismaMock.emailTemplate.createMany as any).mockImplementation(() => {
        // tenantStorage is the same module the extension reads from.
        tenantSeen = tenantStorage.getStore()?.tenantId ?? null;
        return Promise.resolve({ count: 0 });
      });

      await seedDefaultEmailTemplates('tenant-y');
      expect(tenantSeen).toBe('tenant-y');
    });
  });
});
