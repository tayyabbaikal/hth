// Custom server entry point for cPanel / Phusion Passenger (and any plain Node
// host). cPanel's "Setup Node.js App" starts THIS file and injects the PORT to
// listen on. We boot Next.js in production mode and hand requests to it.
//
// CommonJS on purpose (no "type":"module" in package.json) so Passenger loads it.

// Load environment variables from the .env file in the app root the same way
// Next.js does. This makes a single .env file the source of truth for runtime
// too (Passenger doesn't auto-load .env for a custom server).
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

const { createServer } = require("http");
const next = require("next");

const port = process.env.PORT || 3000;
const app = next({ dev: false });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    createServer((req, res) => handle(req, res)).listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`> traffic-exchange ready on port ${port}`);
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start server", err);
    process.exit(1);
  });
