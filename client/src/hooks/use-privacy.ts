import { create } from "zustand";

const PRIVACY_STORAGE_KEY = "codex-loadbalancer:privacy";

type PrivacyState = {
  blurred: boolean;
  toggle: () => void;
};

// 1. Privacy read ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function readPrivacy(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(PRIVACY_STORAGE_KEY) === "1";
}

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  blurred: readPrivacy(),
  toggle: () => {
    const next = !get().blurred;
    window.localStorage.setItem(PRIVACY_STORAGE_KEY, next ? "1" : "0");
    set({ blurred: next });
  },
}));
