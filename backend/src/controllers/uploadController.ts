import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { uploadDir } from '../config/multer';
import { isR2Configured, uploadToR2, buildImageKey } from '../config/r2';
import logger from '../utils/logger';

export const uploadImage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const file = req.file;
    // A PDF must start with %PDF-, so a renamed file of another type is not stored as a receipt.
    if (file.mimetype === 'application/pdf' && file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new AppError('This file is not a valid PDF', 400);
    }
    const tenantId = req.user?.tenantId;
    const key = buildImageKey(file.originalname, tenantId);

    let imageUrl: string;
    if (isR2Configured()) {
      // Durable object storage — survives redeploys and the disk cleanup cron.
      imageUrl = await uploadToR2(file.buffer, key, file.mimetype);
    } else {
      // Local fallback (dev/CI): write the buffered file to disk.
      const filename = path.basename(key);
      await fs.promises.writeFile(path.join(uploadDir, filename), file.buffer);
      imageUrl = `/uploads/${filename}`;
    }

    logger.info(`Image uploaded successfully: ${key}`);

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl,
      url: imageUrl, // Include both formats for compatibility
      file: {
        filename: path.basename(key),
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      }
    });
  } catch (error) {
    logger.error('Error uploading image:', error);
    throw error;
  }
};
