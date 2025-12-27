import { Router } from 'express';
import { upload, handleUploadErrors } from '../config/multer';
import { uploadImage } from '../controllers/uploadController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Upload single image - protected route
router.post('/', authenticate, upload.single('image'), handleUploadErrors, uploadImage);

export default router;
