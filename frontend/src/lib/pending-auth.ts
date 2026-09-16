export interface PendingAuth {
  login: string;
  password: string;
  otpMethod: string;
  requestId: string;
}

const STORAGE_KEY = "pending_auth";

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function setPendingAuth(value: PendingAuth) {
  const storage = getStorage();
  if (storage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  }
}

export function getPendingAuth(): PendingAuth | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value?.login || !value?.password || !value?.otpMethod || !value?.requestId) {
      return null;
    }
    return {
      login: String(value.login),
      password: String(value.password),
      otpMethod: String(value.otpMethod),
      requestId: String(value.requestId),
    };
  } catch {
    return null;
  }
}

export function clearPendingAuth() {
  getStorage()?.removeItem(STORAGE_KEY);
}
