import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { initializeApp, getApp, FirebaseApp } from 'firebase/app';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import * as crypto from 'crypto';

@Injectable()
export class StorageService {
  private app: FirebaseApp;
  private storage: ReturnType<typeof getStorage>;

  constructor() {
    try {
      this.app = getApp();
    } catch {
      this.app = initializeApp({
        apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyDUGF6bwt_CtWvZJXkKatATuFU5UL_S3Z8',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'graph-chat-fca91.firebaseapp.com',
        projectId: process.env.FIREBASE_PROJECT_ID || 'graph-chat-fca91',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'graph-chat-fca91.firebasestorage.app',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '644040441418',
        appId: process.env.FIREBASE_APP_ID || '1:644040441418:web:d8b8f7b77c8656560330b3',
        measurementId: process.env.FIREBASE_MEASUREMENT_ID || 'G-2MSDYCT9BZ',
      });
    }
    this.storage = getStorage(this.app);
  }

  async uploadImage(file: Express.Multer.File): Promise<{ url: string; filename: string }> {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new HttpException(
        `Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Max 10MB for images
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      throw new HttpException(
        `File too large. Maximum size is ${MAX_SIZE / (1024 * 1024)}MB`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex').substring(0, 16);
    const timestamp = Date.now();
    const ext = file.originalname.split('.').pop() || 'jpg';
    const filename = `images/${timestamp}-${hash}.${ext}`;

    const storageRef = ref(this.storage, filename);
    
    await uploadBytes(storageRef, file.buffer, {
      contentType: file.mimetype,
      customMetadata: {
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(storageRef);

    return { url, filename };
  }

  async deleteImage(filename: string): Promise<void> {
    const storageRef = ref(this.storage, filename);
    await deleteObject(storageRef);
  }
}

