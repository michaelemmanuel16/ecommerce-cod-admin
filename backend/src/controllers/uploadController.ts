import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

export const uploadImage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    // Get the uploaded file info
    const file = req.file;

    // Return relative URL so it works with frontend proxy
    const imageUrl = `/uploads/${file.filename}`;

    logger.info(`Image uploaded successfully: ${file.filename}`);

    res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl,
      url: imageUrl, // Include both formats for compatibility
      file: {
        filename: file.filename,
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
