const express = require("express");
const cors = require("cors");
const path = require("path");

const {
  readDb,
  writeDb,
  addFeedEvent,
  calculateEmployeeBonus
} = require("./database");
const { ORION_SCHEDULE } = require("./schedule");
const {
  sendActivityToDiscord,
  sendComunicadoToDiscord,
  sendMeetingToDiscord,
  sendClockPanelToDiscord,
  sendTicketsPanelToDiscord,
  sendLiquidacionToDiscord,
  approveApplicationCore,
  rejectApplicationCore,
  syncMemberRankRole,
  syncMemberDutyRole,
  syncGuildEmployeesToDb,
  updateEmployeeProfileCore,
  sanctionEmployeeCore,
  fireEmployeeCore,
  ensureRRHHRole,
  ensureApplicationLogChannels,
  getGuildMetadata,
  updateBotPresence,
  createServerCounterChannels,
  getBotStatus,
  COMPANY_RANK_ROLES
} = require("./bot");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Endpoint Keep-Alive para UptimeRobot / cron-job.org (mantiene el host gratuito 24/7)
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), bot: getBotStatus() });
});

// Login de Oficiales (Rangos Altos, RRHH e Instructores) mediante Nombre IC + Código de Seguridad
app.post("/api/auth/login", (req, res) => {
  const { icName, securityCode, roleChoice } = req.body || {};
  const cleanName = String(icName || "").trim();
  const cleanCode = String(securityCode || "").trim();

  if (!cleanName || !cleanCode) {
    return res.status(400).json({ ok: false, error: "Ingresá tu Nombre IC y tu Código de Seguridad." });
  }

  const db = readDb();

  // 1. Buscar credencial individual creada desde el Panel o con /mi-acceso en Discord
  const matchedStaff = (db.staffUsers || []).find(
    u => u.securityCode.toLowerCase() === cleanCode.toLowerCase()
  );

  if (matchedStaff) {
    matchedStaff.icName = cleanName;
    addFeedEvent(db, "LOGIN", `${cleanName} (${matchedStaff.roleTitle}) ingresó al Panel Web`);
    writeDb(db);
    return res.json({
      ok: true,
      user: {
        id: matchedStaff.id,
        icName: matchedStaff.icName,
        roleTitle: matchedStaff.roleTitle,
        accessLevel: matchedStaff.accessLevel
      }
    });
  }

  // 2. Código Maestro de Cúpula / Dirección / RRHH / Instructores (por defecto IMP-2026 o 2026)
  const masterCode = (db.config.masterSecurityCode || "IMP-2026").toLowerCase();
  if (cleanCode.toLowerCase() === masterCode || cleanCode === "2026") {
    const roleMap = {
      "Direccion": "👑 Dirección / Rango Alto",
      "RRHH": "💼・Recursos Humanos (RRHH)",
      "Instructor": "📘 Instructor / Evaluador"
    };
    const accessLevel = roleChoice && roleMap[roleChoice] ? roleChoice : "Direccion";
    const roleTitle = roleMap[accessLevel];

    addFeedEvent(db, "LOGIN", `${cleanName} (${roleTitle}) ingresó al Panel Web`);
    writeDb(db);

    return res.json({
      ok: true,
      user: {
        id: "master-" + Date.now(),
        icName: cleanName,
        roleTitle,
        accessLevel
      }
    });
  }

  return res.status(401).json({
    ok: false,
    error: "Código de Seguridad inválido. Usá /mi-acceso en Discord o solicitá tu código a Dirección."
  });
});

// Crear credencial de acceso para un Rango Alto, RRHH o Instructor desde el Panel
app.post("/api/staff/create", (req, res) => {
  const { icName, accessLevel, securityCode } = req.body || {};
  if (!icName || !securityCode) {
    return res.status(400).json({ ok: false, error: "Faltan datos (Nombre IC y Código)." });
  }

  const roleMap = {
    "Direccion": "👑 Dirección / Rango Alto",
    "RRHH": "💼・Recursos Humanos (RRHH)",
    "Instructor": "📘 Instructor / Evaluador"
  };

  const db = readDb();
  const newStaff = {
    id: String(Date.now()),
    discordId: "",
    discordTag: "Creado en Panel",
    icName: String(icName).trim(),
    accessLevel: accessLevel || "RRHH",
    roleTitle: roleMap[accessLevel] || "💼・Recursos Humanos (RRHH)",
    securityCode: String(securityCode).trim(),
    createdAt: new Date().toLocaleDateString("es-AR")
  };

  db.staffUsers.unshift(newStaff);
  addFeedEvent(db, "ACCESO", `Nuevo código de acceso asignado a ${newStaff.icName} (${newStaff.roleTitle})`);
  writeDb(db);
  res.json({ ok: true, staff: newStaff });
});

// Eliminar credencial de acceso
app.post("/api/staff/delete", (req, res) => {
  const { id } = req.body || {};
  const db = readDb();
  db.staffUsers = (db.staffUsers || []).filter(u => String(u.id) !== String(id));
  writeDb(db);
  res.json({ ok: true });
});

// Obtener estado completo sincronizado para el Dashboard
app.get("/api/state", (req, res) => {
  const db = readDb();
  const now = Date.now();

  const employees = db.employees.map(e => {
    let dutySince = "-";
    if (e.onDuty) {
      const diffMins = e.dutyStart ? Math.max(1, Math.round((now - e.dutyStart) / 60000)) : 30;
      const h = Math.floor(diffMins / 60);
      const m = diffMins % 60;
      dutySince = `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
    }
    return {
      ...e,
      dutySince,
      calculatedBonus: calculateEmployeeBonus(e, db.rates)
    };
  });

  res.json({
    bot: getBotStatus(),
    config: db.config,
    guild: getGuildMetadata(),
    rankRoles: COMPANY_RANK_ROLES,
    staffUsers: db.staffUsers || [],
    rates: db.rates,
    employees,
    applications: db.applications || [],
    activitiesLog: db.activitiesLog,
    feedEvents: db.feedEvents,
    schedule: ORION_SCHEDULE
  });
});

// Guardar configuración de Autorol, Código Maestro y Canales de Logs desde el Dashboard
app.post("/api/config", async (req, res) => {
  try {
    const db = readDb();
    db.config = {
      ...db.config,
      ...req.body
    };
    addFeedEvent(db, "CONFIG", "Configuración de Autorol y Seguridad actualizada");
    writeDb(db);
    res.json({ ok: true, config: db.config });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Aprobar Postulación desde el Dashboard (Rangos Altos, RRHH e Instructores)
app.post("/api/applications/approve", async (req, res) => {
  try {
    const { id, roleId, rank, giveEmpleadosRole, reviewerName } = req.body;
    const db = readDb();
    const appItem = (db.applications || []).find(a => String(a.id) === String(id));
    if (!appItem) return res.status(404).json({ ok: false, error: "Solicitud no encontrada" });

    await approveApplicationCore({
      appId: appItem.id,
      guildId: appItem.guildId,
      channelId: appItem.ticketChannelId,
      userId: appItem.userId,
      nombreIc: appItem.nombreHash,
      roleId: roleId || rank || db.config.autoRoleApproveId,
      rango: rank,
      giveEmpleadosRole,
      reviewerName: reviewerName || "Dirección / RRHH"
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Rechazar Postulación desde el Dashboard (Rangos Altos, RRHH e Instructores)
app.post("/api/applications/reject", async (req, res) => {
  try {
    const { id, reason, reviewerName } = req.body;
    const db = readDb();
    const appItem = (db.applications || []).find(a => String(a.id) === String(id));
    if (!appItem) return res.status(404).json({ ok: false, error: "Solicitud no encontrada" });

    await rejectApplicationCore({
      appId: appItem.id,
      guildId: appItem.guildId,
      channelId: appItem.ticketChannelId,
      userId: appItem.userId,
      reason: reason || "No cumple con los requisitos solicitados.",
      reviewerName: reviewerName || "Dirección / RRHH"
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Alternar Entrada / Salida desde el Dashboard
app.post("/api/duty/toggle", (req, res) => {
  const { id } = req.body;
  const db = readDb();
  const emp = db.employees.find(e => String(e.id) === String(id));
  if (!emp) return res.status(404).json({ ok: false, error: "Empleado no encontrado" });

  if (emp.onDuty) {
    const elapsedMs = Date.now() - (emp.dutyStart || Date.now());
    const elapsedHours = Math.max(0.05, elapsedMs / (1000 * 60 * 60));
    emp.onDuty = false;
    emp.dutyStart = null;
    emp.hours = Number((emp.hours + elapsedHours).toFixed(2));
    emp.totalHours = Number(((emp.totalHours || 0) + elapsedHours).toFixed(2));
    addFeedEvent(db, "CLOCK", `${emp.name} cerró turno desde el Dashboard`);
    syncMemberDutyRole(emp.discordId, false).catch(() => null);
  } else {
    emp.onDuty = true;
    emp.dutyStart = Date.now();
    addFeedEvent(db, "CLOCK", `${emp.name} inició turno desde el Dashboard`);
    syncMemberDutyRole(emp.discordId, true).catch(() => null);
  }

  writeDb(db);
  updateBotPresence();
  res.json({ ok: true });
});

// Sumar horas a un empleado
app.post("/api/employee/hour", (req, res) => {
  const { id, amount = 1 } = req.body;
  const db = readDb();
  const emp = db.employees.find(e => String(e.id) === String(id));
  if (!emp) return res.status(404).json({ ok: false, error: "Empleado no encontrado" });

  emp.hours = Math.max(0, Number((emp.hours + Number(amount)).toFixed(2)));
  emp.totalHours = Math.max(0, Number(((emp.totalHours || 0) + Number(amount)).toFixed(2)));
  addFeedEvent(db, "HORAS", `Se acreditó +${amount}h en el legajo de ${emp.name}`);
  writeDb(db);
  res.json({ ok: true });
});

// Otorgar bono extraordinario
app.post("/api/employee/bonus", (req, res) => {
  const { id, amount = 5000 } = req.body;
  const db = readDb();
  const emp = db.employees.find(e => String(e.id) === String(id));
  if (!emp) return res.status(404).json({ ok: false, error: "Empleado no encontrado" });

  emp.bonusExtra = (emp.bonusExtra || 0) + Number(amount);
  addFeedEvent(db, "BONO", `Bono extraordinario de $${Number(amount).toLocaleString("es-AR")} acreditado a ${emp.name}`);
  writeDb(db);
  res.json({ ok: true });
});

// Alta de empleado (/contratar desde Dashboard)
app.post("/api/employee/hire", async (req, res) => {
  const { name, discord, roleId, rank } = req.body;
  const db = readDb();
  const meta = getGuildMetadata();
  const foundRole = (meta.roles || []).find(r => r.id === roleId || r.name === rank);
  const finalRankName = foundRole ? foundRole.name : (rank || "🛡️・Agente de Seguridad");
  const finalRoleId = foundRole ? foundRole.id : (roleId || "1563510109513195550");

  const newEmp = {
    id: String(Date.now()),
    discordId: String(Date.now()),
    name: name || "Nuevo Agente",
    discord: discord || "@nuevo_agente",
    rank: finalRankName,
    roleId: finalRoleId,
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
    attendance: "Confirmado",
    reason: "",
    warnings: 0
  };
  db.employees.push(newEmp);
  addFeedEvent(db, "ALTA", `${newEmp.name} fue incorporado como ${newEmp.rank}`);
  writeDb(db);
  updateBotPresence();
  res.json({ ok: true, employee: newEmp });
});

// Sincronizar empleados reales del servidor de Discord con la pestaña Empleados
app.post("/api/employee/sync-discord", async (req, res) => {
  try {
    const result = await syncGuildEmployeesToDb();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Actualizar perfil completo, rol de Discord, roles especiales, horas, bonos o notas de un empleado
app.post("/api/employee/update", async (req, res) => {
  try {
    const {
      id,
      name,
      roleId,
      rank,
      specialRoles,
      hours,
      bonusExtra,
      warnings,
      notes,
      addWarning,
      attendance,
      reviewerName
    } = req.body;

    if (addWarning) {
      const sancRes = await sanctionEmployeeCore({
        empId: id,
        reason: "Sanción disciplinaria aplicada desde el Expediente",
        reviewerName
      });
      return res.json({ ok: true, employee: sancRes.emp, dmSent: sancRes.dmSent });
    }

    const updatedEmp = await updateEmployeeProfileCore({
      empId: id,
      name,
      roleId,
      rank,
      specialRoles,
      hours,
      bonusExtra,
      warnings,
      notes,
      attendance,
      reviewerName
    });

    res.json({ ok: true, employee: updatedEmp });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Sancionar a un empleado con motivo (envía MD automático al empleado + publica log en #log)
app.post("/api/employee/sanction", async (req, res) => {
  try {
    const { id, reason, reviewerName } = req.body;
    const result = await sanctionEmployeeCore({
      empId: id,
      reason,
      reviewerName
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Despedir / Expulsar a un empleado con motivo (envía Carta de Despido al MD, quita roles o Kickea en Discord y manda Log a #despedido)
app.post("/api/employee/fire", async (req, res) => {
  try {
    const { id, reason, kickFromServer, reviewerName } = req.body;
    const result = await fireEmployeeCore({
      empId: id,
      reason,
      kickFromServer: Boolean(kickFromServer),
      reviewerName
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Dar de baja / eliminar un empleado desde el Dashboard (alias compatible)
app.post("/api/employee/delete", async (req, res) => {
  try {
    const { id, reason, kickFromServer, reviewerName } = req.body;
    const result = await fireEmployeeCore({
      empId: id,
      reason: reason || "Baja administrativa dispuesta desde el Panel de Control.",
      kickFromServer: Boolean(kickFromServer),
      reviewerName: reviewerName || "Dirección / RRHH"
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Actualizar tarifas de comisiones y bonos
app.post("/api/rates", (req, res) => {
  const db = readDb();
  db.rates = {
    ...db.rates,
    ...req.body
  };
  writeDb(db);
  res.json({ ok: true, rates: db.rates });
});

// Reiniciar horas de la semana
app.post("/api/reset-week", (req, res) => {
  const db = readDb();
  db.employees.forEach(e => {
    e.hours = 0;
  });
  addFeedEvent(db, "CICLO", "Cómputo horario semanal reiniciado a 0.0h");
  writeDb(db);
  res.json({ ok: true });
});

// Liquidar semana completa y publicar en #bonos
app.post("/api/liquidar", async (req, res) => {
  try {
    const db = readDb();
    const summary = db.employees.map(e => ({
      name: e.name,
      rank: e.rank,
      hours: e.hours,
      bonus: calculateEmployeeBonus(e, db.rates)
    }));
    const totalAmount = summary.reduce((acc, item) => acc + item.bonus, 0);

    const sent = await sendLiquidacionToDiscord(summary, totalAmount);
    if (!sent) {
      return res.status(400).json({ ok: false, error: "No se pudo publicar en #bonos. Verificá la conexión del bot." });
    }

    db.employees.forEach(e => {
      e.hours = 0;
      e.atm = 0;
      e.alarm = 0;
      e.cam = 0;
      e.escort = 0;
      e.rev = 0;
      e.bonusExtra = 0;
    });

    addFeedEvent(db, "LIQUIDACIÓN", `Cierre semanal emitido en #bonos por $${totalAmount.toLocaleString("es-AR")}`);
    writeDb(db);
    res.json({ ok: true, totalAmount });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Enviar Comunicado Oficial a Discord
app.post("/api/discord/comunicado", async (req, res) => {
  try {
    const { channelId, channelName, title, message, mention, imageUrl } = req.body;
    const result = await sendComunicadoToDiscord({
      channelId,
      channelName,
      title,
      message,
      mention,
      imageUrl
    });

    const db = readDb();
    addFeedEvent(db, "COMUNICADO", `"${title}" publicado en #${result.channelName}`);
    writeDb(db);
    res.json({ ok: true, channelName: result.channelName });
  } catch (err) {
    console.error("Error enviando comunicado:", err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Convocar Reunión Oficial desde el Dashboard hacia #reuniones
app.post("/api/discord/reunion", async (req, res) => {
  try {
    const { channelId, fechaHora, tema } = req.body;
    await sendMeetingToDiscord({ channelId, fechaHora, tema });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/discord/activity", async (req, res) => {
  try {
    const { title, key } = req.body;
    const db = readDb();
    const sent = await sendActivityToDiscord(title, key);
    if (!sent) {
      return res.status(400).json({ ok: false, error: "No se pudo enviar la actividad a Discord." });
    }
    db.activitiesLog.unshift({
      id: Date.now(),
      emp: "En espera de certificación en Discord",
      type: title,
      time: "Recién despachado",
      reward: `$${(db.rates[key] || 3500).toLocaleString("es-AR")}`,
      status: "Activo"
    });
    addFeedEvent(db, "OPERATIVO", `Publicado en #actividades-disponibles: ${title}`);
    writeDb(db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/discord/panel-clock", async (req, res) => {
  try {
    const { channelId } = req.body || {};
    const sent = await sendClockPanelToDiscord(null, channelId);
    if (!sent) return res.status(400).json({ ok: false, error: "No se pudo desplegar el panel /clock" });
    const db = readDb();
    addFeedEvent(db, "SISTEMA", "Panel interactivo /clock enviado a Discord");
    writeDb(db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/discord/panel-tickets", async (req, res) => {
  try {
    const { channelId } = req.body || {};
    const sent = await sendTicketsPanelToDiscord(null, channelId);
    if (!sent) return res.status(400).json({ ok: false, error: "No se pudo desplegar el panel de tickets" });
    const db = readDb();
    addFeedEvent(db, "SISTEMA", "Panel interactivo de Tickets enviado a Discord");
    writeDb(db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/discord/create-counters", async (req, res) => {
  try {
    await ensureRRHHRole();
    const ok = await createServerCounterChannels();
    const logs = await ensureApplicationLogChannels();
    res.json({ ok, logs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function startWebServer() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🖥️ [Dashboard Web] Panel Enterprise activo en http://localhost:${port}`);
  });
}

module.exports = { startWebServer };
