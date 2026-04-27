import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppHeader } from "@/components/layout/app-header";
import { StatusBar } from "@/components/layout/status-bar";
import { AccountsPage } from "@/features/accounts/components/accounts-page";
import { ApisPage } from "@/features/apis/components/apis-page";
import { DashboardPage } from "@/features/dashboard/components/dashboard-page";
import { SettingsPage } from "@/features/settings/components/settings-page";

// 1. App layout ―――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background pb-12 text-foreground">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      <StatusBar />
    </div>
  );
}

// 2. App ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/apis" element={<ApisPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
