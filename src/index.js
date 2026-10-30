require("dotenv").config();
const { startWebServer } = require("./server");
const { startDiscordBot, sendActivityToDiscord } = require("./bot");
const { startActivityScheduler } = require("./schedule");

async function main() {
  console.log("======================================================");
  console.log("🛡️  IMPERION SECURITY — SUITE DE OPERACIONES 24/7");
  console.log("======================================================");

  // 1. Iniciar el Servidor Web + Dashboard Enterprise + Endpoint Keep-Alive
  startWebServer();

  // 2. Iniciar el Bot de Discord 24/7
  await startDiscordBot();

  // 3. Iniciar el Cronograma Automático de 21 Actividades de GTAHub Orion
  startActivityScheduler(async (title, key) => {
    await sendActivityToDiscord(title, key);
  });
}

main();
