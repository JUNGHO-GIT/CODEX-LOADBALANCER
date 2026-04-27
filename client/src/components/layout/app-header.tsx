import { Eye, EyeOff, MoonStar, SunMedium, LaptopMinimal, Menu, X } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { CodexLogo } from "@/components/brand/codex-logo";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { useThemeStore, type ThemePreference } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/accounts", label: "Accounts" },
  { to: "/apis", label: "APIs" },
  { to: "/settings", label: "Settings" },
] as const;

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof SunMedium }> = [
  { value: "light", label: "Light", icon: SunMedium },
  { value: "dark", label: "Dark", icon: MoonStar },
  { value: "auto", label: "Auto", icon: LaptopMinimal },
];

// 1. Nav link item ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function NavItem({ to, label, onClick }: { to: string; label: string; onClick?: () => void }) {
  return (
    <NavLink to={to} onClick={onClick} className={({ isActive }) => cn(
      "inline-flex h-8 items-center rounded-full px-3.5 text-xs font-medium transition-colors",
      isActive
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
    )}
    >
      {label}
    </NavLink>
  );
}

// 2. Theme control ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function ThemeControl() {
  const preference = useThemeStore((state) => state.preference);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <div className="hidden items-center rounded-full border border-border/60 bg-card/70 p-1 sm:flex">
      {themeOptions.map((option) => {
        const Icon = option.icon;
        return (
          <button
            type="button"
            key={option.value}
            className={cn(
              "press-scale inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors",
              preference === option.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-background hover:text-foreground",
            )}
            onClick={() => {
              setTheme(option.value);
            }}
          >
            <Icon className="h-3.5 w-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// 3. App header ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function AppHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const blurred = usePrivacyStore((state) => state.blurred);
  const togglePrivacy = usePrivacyStore((state) => state.toggle);
  const PrivacyIcon = blurred ? EyeOff : Eye;

  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-background/70 px-4 py-3 shadow-[0_1px_12px_rgba(0,0,0,0.06)] backdrop-blur-xl backdrop-saturate-[1.8]">
      <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
            <CodexLogo size={20} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">Codex LB</p>
            <p className="truncate text-xs text-muted-foreground">Reference-aligned local load balancer dashboard</p>
          </div>
        </div>

        <nav className="hidden items-center rounded-full border border-border/60 bg-muted/40 p-1 sm:flex">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} to={item.to} label={item.label} />
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeControl />
          <button
            type="button"
            className="press-scale hidden h-9 items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            onClick={togglePrivacy}
          >
            <PrivacyIcon className="h-3.5 w-3.5" />
            {blurred ? "Show emails" : "Hide emails"}
          </button>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/70 text-muted-foreground transition-colors hover:text-foreground sm:hidden"
            onClick={() => {
              setMobileOpen((current) => !current);
            }}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="mx-auto mt-3 flex w-full max-w-[1500px] flex-col gap-2 rounded-2xl border border-border/60 bg-card/90 p-3 sm:hidden">
          <div className="grid gap-1">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} to={item.to} label={item.label} onClick={() => {
                setMobileOpen(false);
              }}
              />
            ))}
          </div>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-border/60 bg-muted/50 px-3 text-xs font-medium text-muted-foreground"
            onClick={togglePrivacy}
          >
            <PrivacyIcon className="h-3.5 w-3.5" />
            {blurred ? "Show emails" : "Hide emails"}
          </button>
        </div>
      ) : null}
    </header>
  );
}
