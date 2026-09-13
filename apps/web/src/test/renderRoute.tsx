import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../App";

/**
 * Renders the real `App` — its real `Routes`, its real pages — at one URL.
 *
 * Deliberately the whole router rather than a page component in isolation:
 * what these tests are guarding is the wiring a react-router upgrade breaks
 * (path matching, `useParams`, `useNavigate`, `NavLink`), which a directly
 * rendered page would not exercise at all.
 *
 * `MemoryRouter` stands in for `BrowserRouter`, which is the one piece of
 * main.tsx not reused here — everything else about the tree matches.
 */
export function renderRoute(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // A smoke test asserting a failed render should see the failure, not
        // three silent retries and a timeout.
        retry: false,
        staleTime: 0,
      },
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
}
