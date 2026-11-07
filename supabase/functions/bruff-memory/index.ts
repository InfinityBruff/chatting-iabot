import {createMemoryHandler} from './handler.js';
Deno.serve(createMemoryHandler({
 url:Deno.env.get('SUPABASE_URL'),anonKey:Deno.env.get('SUPABASE_ANON_KEY'),
 tursoUrl:Deno.env.get('BRUFF_MEMORY_TURSO_URL'),tursoToken:Deno.env.get('BRUFF_MEMORY_TURSO_TOKEN'),
 catalogBatch:Deno.env.get('BRUFF_MEMORY_CATALOG_BATCH'),enabled:Deno.env.get('BRUFF_MEMORY_ENABLED')==='true',
}));
