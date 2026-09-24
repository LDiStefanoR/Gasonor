import type { APIRoute } from "astro";
import { handleApi } from "../../lib/api";

export const prerender = false;

export const ALL: APIRoute = (ctx) => handleApi(ctx);
export const GET = ALL;
export const POST = ALL;
export const PUT = ALL;
export const DELETE = ALL;
