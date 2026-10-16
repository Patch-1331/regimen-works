import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider } from "@clerk/clerk-react";
import "./index.css";
import App from "./App.tsx";
import { ApiAuthBridge } from "./ApiAuthBridge";

// Mock mode (DN-181): Clerk and the API are stand-ins, so no key is needed.
// Statically false in every other mode, so the build drops what it guards.
const mock = import.meta.env.MODE === "mock";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  string | undefined;
if (!publishableKey && !mock) {
  // Failing loudly beats a blank screen and a console warning: without this
  // key Clerk renders nothing and every API call would 401.
  throw new Error(
    "VITE_CLERK_PUBLISHABLE_KEY is not set — see apps/web/.env.example",
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A mid-workout screen refetching on every focus blip (a notification,
      // switching apps to check a timer) would reset visible state — the
      // WorkoutSession backend is the source of truth either way, so there's
      // no correctness reason to refetch this aggressively.
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

async function boot() {
  // The worker has to be answering before the first query goes out.
  if (mock) {
    const { startMockApi } = await import("./mock/browser");
    await startMockApi();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ClerkProvider publishableKey={publishableKey ?? ""}>
        <ApiAuthBridge>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </ApiAuthBridge>
      </ClerkProvider>
    </StrictMode>,
  );
}

void boot();
