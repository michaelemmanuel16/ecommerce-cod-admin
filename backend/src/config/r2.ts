import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';

// Cloudflare R2 (S3-compatible) object storage for uploaded images.
// When the R2_* env vars are absent (e.g. local dev, CI), the upload
// controller falls back to local disk storage instead.

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;
// Public base URL that serves the bucket (e.g. https://img.codadminpro.com).
const publicUrl = process.env.R2_PUBLIC_URL;

export const isR2Configured = (): boolean =>
  Boolean(accountId && accessKeyId && secretAccessKey && bucket && publicUrl);

const client = isR2Configured()
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    })
  : null;

// Sanitize a filename into a safe slug (no spaces or special characters).
export const sanitizeFilename = (filename: string): string => {
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  return nameWithoutExt
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

// Build a unique, tenant-scoped object key: products/<tenant>/<name>-<suffix>.<ext>
export const buildImageKey = (originalName: string, tenantId?: string | null): string => {
  const ext = path.extname(originalName);
  const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const name = sanitizeFilename(originalName) || 'image';
  const prefix = tenantId ? `products/${tenantId}` : 'products/shared';
  return `${prefix}/${name}-${suffix}${ext}`;
};

// Upload a buffer to R2 and return its public URL.
export const uploadToR2 = async (
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> => {
  if (!client) {
    throw new Error('R2 is not configured');
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${publicUrl!.replace(/\/$/, '')}/${key}`;
};
