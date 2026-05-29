const memoryStorage = new Map();

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const safeStorage = {
  getItem(key) {
    try {
      const stored = getLocalStorage()?.getItem(key);
      return stored ?? memoryStorage.get(key) ?? null;
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  },

  setItem(key, value) {
    memoryStorage.set(key, String(value));

    try {
      const storage = getLocalStorage();
      if (!storage) return false;
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  removeItem(key) {
    memoryStorage.delete(key);

    try {
      const storage = getLocalStorage();
      if (!storage) return false;
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};
