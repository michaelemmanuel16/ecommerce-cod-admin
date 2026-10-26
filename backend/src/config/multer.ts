import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AppError } from '../middleware/errorHandler';

// Ensure uploads directory exists (used only when R2 is not configured)
export const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Images are buffered in memory so the controller can push them to R2
// (or write them to disk as a fallback). See uploadController.ts.
const storage = multer.memoryStorage();

/** What POST /api/upload accepts: images, and PDF for expense receipts (F-919). The screens read these values. */
export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (UPLOAD_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only JPEG, PNG, GIF, WebP images and PDF files are allowed (max 15 MB)', 400));
  }
};

// Configure multer for images (original)
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD_MAX_BYTES,  // 15MB max file size
    files: 1,                    // Only 1 file per request (prevent DoS)
    fields: 10,                  // Max 10 form fields (prevent field flooding)
    parts: 20,                   // Max 20 parts in multipart (prevent multipart DoS)
    headerPairs: 100             // Max 100 header pairs
  }
});

// Memory storage for spreadsheet parsing
export const memoryStorage = multer.memoryStorage();

// File filter for spreadsheets - extension check only
// Note: MIME type validation is done in the controller after file is uploaded
// because file.buffer is not available during the filter stage
const spreadsheetFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
  const ext = path.extname(file.originalname).toLowerCase();

  // First check extension
  if (!allowedExtensions.includes(ext)) {
    return cb(new AppError('Only CSV and Excel files are allowed', 400));
  }

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
      return res.status(400).json({ error: 'File too large (max 15MB). Use a JPEG, PNG, WebP or PDF file under 15 MB.' });
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

// Profile photo (F-1222): jpeg, png, webp, up to 5 MB. Over the limit is 413, not 400.
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export const avatarUpload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Photo must be a JPEG, PNG or WebP image', 400));
    }
  },
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 5, parts: 10 }
});

export const handleAvatarErrors = (err: any, _req: any, _res: any, next: any) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return next(new AppError('Photo is too large (max 5 MB)', 413));
  }
  if (err instanceof multer.MulterError) {
    return next(new AppError(`Upload error: ${err.message}`, 400));
  }
  next(err);
};

// Import upload (F-319): a file over the 10 MB limit is HTTP 413
export const handleImportUploadErrors = (err: any, req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'File too large. The limit is 10 MB' });
  }
  return handleUploadErrors(err, req, res, next);
};
