import { create } from "zustand";

const THEME_STORAGE_KEY = "codex-loadbalancer:theme";

export type ThemePreference = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

type ThemeState = {
  preference: ThemePreference;
  theme: ResolvedTheme;
  initialized: boolean;
  initializeTheme: () => void;
  setTheme: (preference: ThemePreference) => void;
};

// 1. Theme apply ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

// 2. System theme read ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// 3. Theme resolve ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "auto" ? getSystemTheme() : preference;
}

// 4. Preference read ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function readPreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "auto";
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null;

// 5. System listener clear ――――――――――――――――――――――――――――――――――――――――――――――――――――――
function clearSystemListener(): void {
  if (mediaQuery !== null && mediaListener !== null) {
    mediaQuery.removeEventListener("change", mediaListener);
  }
  mediaQuery = null;
  mediaListener = null;
}

// 6. System listener bind ――――――――――――――――――――――――――――――――――――――――――――――――――――――
function bindSystemListener(): void {
  clearSystemListener();
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaListener = () => {
    const state = useThemeStore.getState();
    if (state.preference === "auto") {
      const theme = getSystemTheme();
      applyTheme(theme);
      useThemeStore.setState({ theme });
    }
  };
  mediaQuery.addEventListener("change", mediaListener);
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: "auto",
  theme: "light",
  initialized: false,
  initializeTheme: () => {
    const preference = readPreference();
    const theme = resolveTheme(preference);
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    set({ preference, theme, initialized: true });
    if (preference === "auto") {
      bindSystemListener();
    }
  },
  setTheme: (preference) => {
    const theme = resolveTheme(preference);
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    set({ preference, theme, initialized: true });
    if (preference === "auto") {
      bindSystemListener();
    }
    else {
      clearSystemListener();
    }
  },
}));
