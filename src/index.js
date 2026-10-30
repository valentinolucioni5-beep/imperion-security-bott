require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { startWebServer } = require("./server");
const { startDiscordBot, sendActivityToDiscord } = require("./bot");
const { startActivityScheduler } = require("./schedule");
const { readDb, writeDb } = require("./database");

// Protección global 24/7 para que errores transitorios de red de Discord nunca apaguen el servidor
process.on("unhandledRejection", err => {
  console.error("⚠️ [Protección 24/7 - UnhandledRejection]:", err?.message || err);
});
process.on("uncaughtException", err => {
  console.error("⚠️ [Protección 24/7 - UncaughtException]:", err?.message || err);
});

function startCloudflareTunnel() {
  if (process.env.RENDER_EXTERNAL_URL) {
    try {
      const db = readDb();
      db.config.publicDashboardUrl = process.env.RENDER_EXTERNAL_URL;
      writeDb(db);
    } catch (e) {}
    return;
  }
  const cfPath = path.join(__dirname, "..", "cloudflared.exe");
  if (!fs.existsSync(cfPath)) return;

  const proc = spawn(cfPath, ["tunnel", "--url", "http://localhost:3000", "--no-autoupdate"], {
    windowsHide: true
  });

  const handleOutput = data => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      const publicUrl = match[0];
      console.log(`🌐 [Link Web Público Cloudflare 24/7]: ${publicUrl}`);
      try {
        const db = readDb();
        db.config.publicDashboardUrl = publicUrl;
        writeDb(db);
      } catch (e) {
        // ignore
      }
    }
  };

  proc.stdout.on("data", handleOutput);
  proc.stderr.on("data", handleOutput);
  proc.on("error", () => {});
}

async function main() {
  console.log("======================================================");
  console.log("🛡️  IMPERION SECURITY — SUITE DE OPERACIONES 24/7");
  console.log("======================================================");

  // 1. Iniciar el Servidor Web + Dashboard Enterprise + Endpoint Keep-Alive
  startWebServer();

  // 2. Iniciar Túnel Público Cloudflare Permanente (no caduca cada 15 min)
  startCloudflareTunnel();

  // 3. Iniciar el Bot de Discord 24/7
  await startDiscordBot();

  // 4. Iniciar el Cronograma Automático de 21 Actividades de GTAHub Orion
  startActivityScheduler(async (title, key) => {
    await sendActivityToDiscord(title, key);
  });
}

main();
