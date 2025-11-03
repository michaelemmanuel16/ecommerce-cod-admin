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

    // Construct the URL for the uploaded file
    // In production, you would typically upload to S3/CloudFront and return that URL
    // For now, we'll serve static files from the uploads directory
    const baseUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;
    const imageUrl = `${baseUrl}/uploads/${file.filename}`;

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
