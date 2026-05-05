import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'wedding_offline_db';
const STORE_NAME = 'checkin_queue';

export interface OfflineCheckin {
  localId: string;
  token: string;
  contact: any;
  action: string;
  timestamp: number;
  retryCount: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export const getDB = () => {
  if (typeof window === 'undefined') return null;
  
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'localId' });
        }
      },
    });
  }
  return dbPromise;
};

export const addToQueue = async (checkin: OfflineCheckin) => {
  const db = await getDB();
  if (!db) return;
  await db.put(STORE_NAME, checkin);
};

export const getQueue = async (): Promise<OfflineCheckin[]> => {
  const db = await getDB();
  if (!db) return [];
  return db.getAll(STORE_NAME);
};

export const removeFromQueue = async (localId: string) => {
  const db = await getDB();
  if (!db) return;
  await db.delete(STORE_NAME, localId);
};

export const updateQueueItem = async (checkin: OfflineCheckin) => {
  const db = await getDB();
  if (!db) return;
  await db.put(STORE_NAME, checkin);
};
