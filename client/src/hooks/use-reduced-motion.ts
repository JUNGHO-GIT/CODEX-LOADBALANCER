import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// 1. Match read ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function getMatch(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

// 2. Reduced motion read ――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(getMatch);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(QUERY);
    const handler = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    mediaQueryList.addEventListener("change", handler);
    return () => {
      mediaQueryList.removeEventListener("change", handler);
    };
  }, []);

  return reduced;
}
