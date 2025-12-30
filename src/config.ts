// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: 'AIzaSyDUGF6bwt_CtWvZJXkKatATuFU5UL_S3Z8',
  authDomain: 'graph-chat-fca91.firebaseapp.com',
  projectId: 'graph-chat-fca91',
  storageBucket: 'graph-chat-fca91.firebasestorage.app',
  messagingSenderId: '644040441418',
  appId: '1:644040441418:web:d8b8f7b77c8656560330b3',
  measurementId: 'G-2MSDYCT9BZ',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
