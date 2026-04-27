import { create } from "zustand";

const TIME_FORMAT_STORAGE_KEY = "codex-loadbalancer:time-format";

export type TimeFormatPreference = "12h" | "24h";

type TimeFormatState = {
  timeFormat: TimeFormatPreference;
  setTimeFormat: (preference: TimeFormatPreference) => void;
};

// 1. Time format read ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function readTimeFormat(): TimeFormatPreference {
  if (typeof window === "undefined") {
    return "12h";
  }
  return window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY) === "24h" ? "24h" : "12h";
}

// 2. Time format current ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function getTimeFormatPreference(): TimeFormatPreference {
  return useTimeFormatStore.getState().timeFormat;
}

export const useTimeFormatStore = create<TimeFormatState>((set) => ({
  timeFormat: readTimeFormat(),
  setTimeFormat: (preference) => {
    window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, preference);
    set({ timeFormat: preference });
  },
}));
