import { get, set, del } from 'idb-keyval';
import { StateStorage } from 'zustand/middleware';

/**
 * Custom storage adapter for Zustand persist middleware
 * Uses IndexedDB via idb-keyval to handle large form states like Base64 images
 * overcoming the 5MB localStorage limit.
 */
export const indexedDBStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        return (await get(name)) || null;
    },
    setItem: async (name: string, value: string): Promise<void> => {
        await set(name, value);
    },
    removeItem: async (name: string): Promise<void> => {
        await del(name);
    },
};
