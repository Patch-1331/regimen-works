import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api";
import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";
import { TabBar } from "./components/TabBar";
import { TodayPage } from "./pages/TodayPage";
import { HistoryPage } from "./pages/HistoryPage";
import { StatsPage } from "./pages/StatsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { WodLibraryPage } from "./pages/WodLibraryPage";
import { ActiveWorkoutPage } from "./pages/ActiveWorkoutPage";
import { LogResultPage } from "./pages/LogResultPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WarmupPage } from "./pages/WarmupPage";
import { CooldownPage } from "./pages/CooldownPage";
import { SetupPage } from "./pages/SetupPage";

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

/**
 * Sends an athlete who has not finished setup into it (DN-15).
 *
 * `onboardedAt` is the only input, and it is stamped last of everything the
 * commit writes — so an athlete who abandoned the wizard halfway comes back
 * to the start of it rather than to a program they never confirmed.
 *
 * Nothing renders while `/me` is in flight. A gate that rendered the app
 * first would flash Today at someone about to be redirected away from it,
 * and Today is a screen that starts fetching a workout.
 *
 * It fails open: a `/me` that errors leaves the app rendered rather than
 * trapping the athlete in a wizard whose own commit would fail too. This is
 * not access control — the API owns what setup writes — it is the difference
 * between a configured app and an unconfigured one.
 */
function SetupGate({ children }: { children: React.ReactNode }) {
  const { data: me, isPending } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
  });
  const location = useLocation();

  if (isPending) return null;
  if (me?.onboardedAt === null && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <AuthGate>
      <SetupGate>
        <Routes>
          <Route element={<TabbedLayout />}>
            <Route path="/" element={<TodayPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/stats" element={<StatsPage />} />
            {/* `/library` rather than `/exercises`: DN-29 brings WODs to the
              same home, and they belong under one word, not two tabs. */}
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/wods" element={<WodLibraryPage />} />
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
          {/* Outside the tabbed layout: there is nowhere else to be until the
            three questions are answered. */}
          <Route path="/setup" element={<SetupPage />} />
        </Routes>
      </SetupGate>
    </AuthGate>
  );
}

export default App;
