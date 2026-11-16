import { createRecoveredHandlers } from '../_shared/recovered_handlers.mjs';
Deno.serve(createRecoveredHandlers({getenv: (name: string) => Deno.env.get(name)}).deleteInvoiceBundle);
