// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// Note: Firebase client-side API keys are public by design, but using env vars for maintainability
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyDUGF6bwt_CtWvZJXkKatATuFU5UL_S3Z8',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'graph-chat-fca91.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'graph-chat-fca91',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'graph-chat-fca91.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '644040441418',
  appId: process.env.FIREBASE_APP_ID || '1:644040441418:web:d8b8f7b77c8656560330b3',
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || 'G-2MSDYCT9BZ',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
