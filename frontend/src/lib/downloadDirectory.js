const DB_NAME = 'tubeSprintSettings';
const STORE_NAME = 'kv';
const KEY_DOWNLOAD_DIRECTORY = 'downloadDirectory';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setValue(key, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getValue(key) {
  const db = await openDb();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

export function supportsDirectoryPicker() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;
}

export async function ensureWritePermission(directoryHandle) {
  if (!directoryHandle) {
    return false;
  }

  const readWrite = { mode: 'readwrite' };

  if ((await directoryHandle.queryPermission(readWrite)) === 'granted') {
    return true;
  }

  return (await directoryHandle.requestPermission(readWrite)) === 'granted';
}

export async function pickAndStoreDirectory() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await setValue(KEY_DOWNLOAD_DIRECTORY, handle);
  return handle;
}

export async function getStoredDirectory() {
  return getValue(KEY_DOWNLOAD_DIRECTORY);
}
