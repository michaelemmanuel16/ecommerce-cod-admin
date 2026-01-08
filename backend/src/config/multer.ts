import multer from 'multer';
import path from 'path';
import fs from 'fs';
import fileType from 'file-type';
import { AppError } from '../middleware/errorHandler';

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Sanitize filename - remove spaces and special characters
const sanitizeFilename = (filename: string): string => {
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);

  const sanitized = nameWithoutExt
    .toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/[^a-z0-9-_]/g, '')    // Remove special characters
    .replace(/-+/g, '-')            // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens

  return sanitized;
};

// Configure storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // Generate unique filename: sanitizedname-timestamp-random.ext
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    const sanitizedName = sanitizeFilename(file.originalname);
    cb(null, `${sanitizedName}-${uniqueSuffix}${ext}`);
  }
});

// File filter - only allow images
const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only image files are allowed (JPEG, PNG, GIF, WebP)', 400));
  }
};

// Configure multer for images (original)
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,  // 5MB max file size
    files: 1,                    // Only 1 file per request (prevent DoS)
    fields: 10,                  // Max 10 form fields (prevent field flooding)
    parts: 20,                   // Max 20 parts in multipart (prevent multipart DoS)
    headerPairs: 100             // Max 100 header pairs
  }
});

// Memory storage for spreadsheet parsing
export const memoryStorage = multer.memoryStorage();

// File filter for spreadsheets with MIME type validation
const spreadsheetFilter = async (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
  const ext = path.extname(file.originalname).toLowerCase();

  // First check extension
  if (!allowedExtensions.includes(ext)) {
    return cb(new AppError('Only CSV and Excel files are allowed', 400));
  }

  // For Excel files, validate MIME type from buffer content
  if (ext === '.xlsx' || ext === '.xls') {
    try {
      // Note: file-type v16+ uses default export
      const detectedType = await fileType.fromBuffer(file.buffer as any);
      const validMimeTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];

      if (!detectedType || !validMimeTypes.includes(detectedType.mime)) {
        return cb(new AppError('Invalid Excel file format detected', 400));
      }
    } catch (error) {
      return cb(new AppError('Failed to validate file type', 400));
    }
  }

  // CSV files don't have reliable MIME types, so we only check extension
  cb(null, true);
};

export const spreadsheetUpload = multer({
  storage: memoryStorage,
  fileFilter: spreadsheetFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  }
});

// Error handler for multer upload errors
export const handleUploadErrors = (err: any, _req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large (max 5MB)' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files (max 1)' });
    }
    if (err.code === 'LIMIT_FIELD_COUNT') {
      return res.status(400).json({ error: 'Too many form fields' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field' });
    }
    if (err.code === 'LIMIT_PART_COUNT') {
      return res.status(400).json({ error: 'Too many parts in multipart data' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }

  // Pass other errors to error handler
  next(err);
};
