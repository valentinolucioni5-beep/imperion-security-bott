const cron = require("node-cron");
const { readDb, writeDb, addFeedEvent } = require("./database");

/**
 * Cronograma Oficial de 21 Actividades Diarias — GTAHub Orion (Extraído de Carl-bot)
 * Se ejecutan en el minuto :59 de cada hora correspondiente.
 */
const ORION_SCHEDULE = [
  { hour: 0, minute: 59, title: "REABASTECER CAJEROS #1", key: "atm" },
  { hour: 2, minute: 59, title: "INSTALACIÓN DE ALARMAS #2", key: "alarm" },
  { hour: 3, minute: 59, title: "REABASTECER CAJEROS #2", key: "atm" },
  { hour: 4, minute: 59, title: "SERVICIO DE ESCOLTA #2", key: "escort" },
  { hour: 6, minute: 59, title: "REABASTECER CAJEROS #3", key: "atm" },
  { hour: 8, minute: 59, title: "REPARACIÓN DE CÁMARAS #3", key: "cam" },
  { hour: 9, minute: 59, title: "REABASTECER CAJEROS #4", key: "atm" },
  { hour: 11, minute: 59, title: "SERVICIO DE ESCOLTA #3", key: "escort" },
  { hour: 12, minute: 59, title: "REABASTECER CAJEROS #5", key: "atm" },
  { hour: 13, minute: 59, title: "REVISIÓN DE SEGURIDAD #2", key: "rev" },
  { hour: 14, minute: 59, title: "INSTALACIÓN DE ALARMAS #3", key: "alarm" },
  { hour: 15, minute: 59, title: "REPARACIÓN DE CÁMARAS #4", key: "cam" },
  { hour: 16, minute: 59, title: "INSTALACIÓN DE ALARMAS #4", key: "alarm" },
  { hour: 17, minute: 59, title: "SERVICIO DE ESCOLTA #4", key: "escort" },
  { hour: 18, minute: 59, title: "INSTALACIÓN DE ALARMAS #5", key: "alarm" },
  { hour: 18, minute: 59, title: "REABASTECER CAJEROS #6", key: "atm" },
  { hour: 20, minute: 59, title: "REPARACIÓN DE CÁMARAS #1", key: "cam" },
  { hour: 20, minute: 59, title: "REVISIÓN DE SEGURIDAD #1", key: "rev" },
  { hour: 21, minute: 59, title: "SERVICIO DE ESCOLTA #1", key: "escort" },
  { hour: 22, minute: 59, title: "REPARACIÓN DE CÁMARAS #2", key: "cam" },
  { hour: 23, minute: 59, title: "INSTALACIÓN DE ALARMAS #1", key: "alarm" }
];

function getActivityImageUrl(key) {
  const db = readDb();
  const customImages = db.config?.images || {};
  const map = {
    atm: customImages.atm || process.env.IMG_CAJEROS || "https://placehold.co/800x450/0a192f/3b82f6/png?text=ACTIVIDAD+REABASTECIMIENTO+DE+CAJEROS",
    alarm: customImages.alarm || process.env.IMG_ALARMAS || "https://placehold.co/800x450/0a192f/3b82f6/png?text=ACTIVIDAD+INSTALACION+DE+ALARMAS",
    cam: customImages.cam || process.env.IMG_CAMARAS || "https://placehold.co/800x450/0a192f/3b82f6/png?text=ACTIVIDAD+REPARACION+DE+CAMARAS",
    escort: customImages.escort || process.env.IMG_ESCOLTA || "https://placehold.co/800x450/0a192f/3b82f6/png?text=ACTIVIDAD+SERVICIO+DE+ESCOLTA",
    rev: customImages.rev || process.env.IMG_REVISION || "https://placehold.co/800x450/0a192f/3b82f6/png?text=ACTIVIDAD+REVISION+DE+SEGURIDAD"
  };
  return map[key] || map.atm;
}

function startActivityScheduler(sendActivityCallback) {
  const timezone = process.env.TIMEZONE || "America/Argentina/Buenos_Aires";

  ORION_SCHEDULE.forEach(item => {
    const cronExpr = `${item.minute} ${item.hour} * * *`;
    cron.schedule(
      cronExpr,
      async () => {
        const db = readDb();
        addFeedEvent(db, "AUTO", `Despacho automático Orion: ${item.title}`);
        writeDb(db);
        if (typeof sendActivityCallback === "function") {
          await sendActivityCallback(item.title, item.key);
        }
      },
      { timezone }
    );
  });

  console.log(`[Cron Orion] ${ORION_SCHEDULE.length} actividades diarias programadas (${timezone}).`);
}

module.exports = {
  ORION_SCHEDULE,
  getActivityImageUrl,
  startActivityScheduler
};
