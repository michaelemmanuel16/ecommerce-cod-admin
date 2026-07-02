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
    fileSize: 15 * 1024 * 1024, // 15MB max file size
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
      return res.status(400).json({ error: 'File too large (max 15MB)' });
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
