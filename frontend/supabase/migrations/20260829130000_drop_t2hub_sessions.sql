-- Drop the t2hub_sessions table. The server-side bootstrap from the t2hub
-- landing page was attempted first, but t2hub's public landing pages no
-- longer expose window.__sk (the key is only present once a caller is
-- logged in). The booking flow is moving to a client-side bridge that
-- forwards the user's own session material via x-client-session +
-- x-client-proof headers (the design introduced in 17d9370), so a shared
-- server-side row is no longer needed.
DROP TABLE IF EXISTS public.t2hub_sessions;
