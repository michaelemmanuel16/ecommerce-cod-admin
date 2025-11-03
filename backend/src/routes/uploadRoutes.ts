import { Router } from 'express';
import { upload } from '../config/multer';
import { uploadImage } from '../controllers/uploadController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Upload single image - protected route
router.post('/', authenticate, upload.single('image'), uploadImage);

export default router;
