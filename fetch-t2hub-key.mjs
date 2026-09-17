import { loadSession, updateSessionCookies } from "./src/lib/t2hub-session.js";

const s = loadSession();
if (!s) { console.log("No session"); process.exit(1); }

const cookie = s.cookie || s.cookies?.map(c => c.name + "=" + c.value).join("; ");

const urls = [
  "https://t2hub.app/takamol/",
  "https://t2hub.app/takamol/agent/login",
  "https://takamol.t2hub.app/",
];

for (const url of urls) {
  try {
    const res = await fetch(url, { headers: { Cookie: cookie || "" }, redirect: "follow" });
    const html = await res.text();
    const m = html.match(/window\.__sk\s*=\s*["']([^"']+)["']/);
    if (m) {
      console.log("KEY:", m[1]);
      console.log("KEY_LENGTH:", m[1].length);
      // Update local session with the key
      const fs = await import("fs");
      const path = new URL("./src/lib/t2hub-session.js", import.meta.url).pathname;
      // Write to .env or session file
      process.exit(0);
    }
    console.log(`No key in ${url} (html length: ${html.length})`);
  } catch (e) {
    console.log(`Error fetching ${url}: ${e.message}`);
  }
}
console.log("No encryption key found on any URL");
