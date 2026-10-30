const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const defaultData = {
  config: {
    empleadosRoleId: process.env.ROLE_EMPLEADOS_ID || "1564762865246675074",
    rrhhRoleId: "",
    autoRoleApproveId: "1563510109513195550", // 🛡️・Agente de Seguridad por defecto
    giveEmpleadosRoleOnApprove: true,
    enServicioRoleId: "1564763063197110372",
    clockChannelId: process.env.CHANNEL_CLOCK_ID || "1564772465819787314",
    actividadesChannelId: process.env.CHANNEL_ACTIVIDADES_ID || "1564773893883822100",
    bonosChannelId: process.env.CHANNEL_BONOS_ID || "1564772178371547216",
    reunionesChannelId: process.env.CHANNEL_REUNIONES_ID || "1563511968541970513",
    anunciosChannelId: process.env.CHANNEL_ANUNCIOS_ID || "1563511678254190602",
    uniformeChannelId: "1564772258646589641",
    soporteChannelId: "1347868773914247179",
    ticketsCategoryId: process.env.CATEGORY_TICKETS_ID || "1563499611665072240",
    logAprobadasChannelId: "1565718380835635384",
    logRechazadasChannelId: "1565718383188779118",
    counterEmpleadosChannelId: "1565707074053210175",
    counterServicioChannelId: "1565707076888428675",
    maxDutyHours: 5,
    masterSecurityCode: "IMP-2026"
  },
  rates: {
    hour: 1500,
    atm: 3500,
    alarm: 3200,
    cam: 3000,
    escort: 6000,
    rev: 4000
  },
  staffUsers: [],
  employees: [],
  applications: [],
  activitiesLog: [],
  feedEvents: []
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2), "utf8");
  }
}

function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    parsed.config = {
      ...defaultData.config,
      ...(parsed.config || {})
    };
    for (const [k, v] of Object.entries(defaultData.config)) {
      if (parsed.config[k] === "" && v !== "") {
        parsed.config[k] = v;
      }
    }
    if (!parsed.applications) parsed.applications = [];
    if (!parsed.employees) parsed.employees = [];
    if (!parsed.staffUsers) parsed.staffUsers = [];
    parsed.employees = parsed.employees.filter(e => e.discordId !== "1565688336629366904");
    return parsed;
  } catch (err) {
    console.error("Error leyendo base de datos, restaurando valores por defecto:", err);
    return JSON.parse(JSON.stringify(defaultData));
  }
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function nowTimeStr() {
  const now = new Date();
  return now.toTimeString().slice(0, 5);
}

function addFeedEvent(db, tag, text) {
  db.feedEvents.unshift({
    time: nowTimeStr(),
    tag,
    text
  });
  if (db.feedEvents.length > 40) {
    db.feedEvents = db.feedEvents.slice(0, 40);
  }
}

function calculateEmployeeBonus(emp, rates) {
  return Math.round(
    (emp.hours || 0) * (rates.hour || 1500) +
    (emp.atm || 0) * (rates.atm || 3500) +
    (emp.alarm || 0) * (rates.alarm || 3200) +
    (emp.cam || 0) * (rates.cam || 3000) +
    (emp.escort || 0) * (rates.escort || 6000) +
    (emp.rev || 0) * (rates.rev || 4000) +
    (emp.bonusExtra || 0)
  );
}

function findOrCreateEmployee(db, userId, username, displayName) {
  let emp = db.employees.find(e => e.discordId === String(userId) || e.id === String(userId));
  if (!emp) {
    emp = {
      id: String(userId),
      discordId: String(userId),
      name: displayName || username,
      discord: `@${username}`,
      rank: "🛡️・Agente de Seguridad",
      roleId: "1563510109513195550",
      onDuty: false,
      dutyStart: null,
      hours: 0,
      totalHours: 0,
      atm: 0,
      alarm: 0,
      cam: 0,
      escort: 0,
      rev: 0,
      bonusExtra: 0,
      attendance: "Pendiente",
      reason: "",
      warnings: 0
    };
    db.employees.push(emp);
  }
  return emp;
}

module.exports = {
  readDb,
  writeDb,
  addFeedEvent,
  calculateEmployeeBonus,
  findOrCreateEmployee,
  nowTimeStr
};
