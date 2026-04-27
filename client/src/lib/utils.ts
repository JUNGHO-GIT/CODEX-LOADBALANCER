import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// 1. Class merge ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
