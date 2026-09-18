import { Outlet, Route, Routes } from "react-router-dom";
import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";
import { TabBar } from "./components/TabBar";
import { TodayPage } from "./pages/TodayPage";
import { HistoryPage } from "./pages/HistoryPage";
import { StatsPage } from "./pages/StatsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { ActiveWorkoutPage } from "./pages/ActiveWorkoutPage";
import { LogResultPage } from "./pages/LogResultPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WarmupPage } from "./pages/WarmupPage";
import { CooldownPage } from "./pages/CooldownPage";

function TabbedLayout() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-[var(--bg)]">
      <div className="flex justify-end px-4 pt-3">
        <UserButton />
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}

/**
 * Every route reads per-user data, so there is nothing meaningful to render
 * signed out — the whole app sits behind the gate rather than each page
 * handling an empty state.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
    </>
  );
}

function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<TabbedLayout />}>
          <Route path="/" element={<TodayPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/stats" element={<StatsPage />} />
          {/* `/library` rather than `/exercises`: DN-29 brings WODs to the
              same home, and they belong under one word, not two tabs. */}
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route
          path="/workout/:assignmentId"
          element={
            <div className="mx-auto max-w-md">
              <ActiveWorkoutPage />
            </div>
          }
        />
        <Route path="/log/:assignmentId" element={<LogResultPage />} />
        <Route path="/warmup/:assignmentId" element={<WarmupPage />} />
        <Route path="/cooldown/:assignmentId" element={<CooldownPage />} />
      </Routes>
    </AuthGate>
  );
}

export default App;
