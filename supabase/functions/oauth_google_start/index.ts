import { handlers } from '../_shared/oauth_adapter.ts';
Deno.serve(handlers.start);
