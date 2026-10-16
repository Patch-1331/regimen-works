import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);

/** Re-exported so tests can override a handler without a second msw import. */
export { http, HttpResponse };
