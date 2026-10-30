const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

const {
  readDb,
  writeDb,
  addFeedEvent,
  calculateEmployeeBonus,
  findOrCreateEmployee
} = require("./database");
const { getActivityImageUrl } = require("./schedule");

// Roles jerárquicos reales del servidor ℑ𝔪𝔭𝔢𝔯𝔦𝔬𝔫 𝔖𝔢𝔠𝔲𝔯𝔦𝔱𝔶 (se actualiza dinámicamente con RRHH al iniciar)
const COMPANY_RANK_ROLES = [
  { id: "1563510109513195550", name: "🛡️・Agente de Seguridad" },
  { id: "1563509992680726608", name: "📋 Evaluador" },
  { id: "1563509865350168598", name: "📘 Instructor" },
  { id: "1563509826833879141", name: "📋 Supervisor" },
  { id: "1563509796324249620", name: "🎯 Supervisor General" },
  { id: "1563509740753915925", name: "⭐ Subjefe de Seguridad" },
  { id: "1563509687897428018", name: "🎖️ Jefe de Seguridad" },
  { id: "1563509539867988050", name: "📊 Subdirector" },
  { id: "1563509440257331330", name: "🤝 Socio Empresarial" },
  { id: "1563509233289269268", name: "🏢 Director General" },
  { id: "1563508912261697538", name: "💎 Co-Fundador" },
  { id: "1563508474820825138", name: "👑 CEO / Fundador" }
];

// IDs de roles autorizados para Aprobar / Rechazar Solicitudes (Rangos Altos + RRHH + Instructores)
const AUTHORIZED_REVIEWER_ROLE_IDS = new Set([
  "1563508474820825138", // 👑 CEO / Fundador
  "1563508912261697538", // 💎 Co-Fundador
  "1563509233289269268", // 🏢 Director General
  "1563509440257331330", // 🤝 Socio Empresarial
  "1563509539867988050", // 📊 Subdirector
  "1563509687897428018", // 🎖️ Jefe de Seguridad
  "1563509740753915925", // ⭐ Subjefe de Seguridad
  "1563509796324249620", // 🎯 Supervisor General
  "1563509826833879141", // 📋 Supervisor
  "1563509865350168598", // 📘 Instructor
  "1563509992680726608", // 📋 Evaluador
  "1347331242693099622", // Lider
  "1347703732250476665", // Administrador
  "1350204400076849173"  // administrador
]);

const ticketSelectedRoleMap = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

let isBotConnected = false;

function getPrimaryGuild() {
  if (!isBotConnected) return null;
  return client.guilds.cache.get("1347278829785190420") || client.guilds.cache.first() || null;
}

// Verifica si un miembro de Discord es Rango Alto, RRHH o Instructor para poder evaluar postulaciones
function canMemberReviewApplications(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;

  const db = readDb();
  if (db.config.rrhhRoleId && member.roles.cache.has(db.config.rrhhRoleId)) return true;

  for (const roleId of AUTHORIZED_REVIEWER_ROLE_IDS) {
    if (member.roles.cache.has(roleId)) return true;
  }

  return member.roles.cache.some(r => {
    const n = r.name.toLowerCase();
    return (
      n.includes("rrhh") ||
      n.includes("recursos humanos") ||
      n.includes("instructor") ||
      n.includes("evaluador") ||
      n.includes("supervisor") ||
      n.includes("jefe") ||
      n.includes("director") ||
      n.includes("fundador") ||
      n.includes("ceo") ||
      n.includes("socio") ||
      n.includes("lider")
    );
  });
}

// Obtiene el título del rol más alto de un revisor para mostrar en los logs
function getReviewerDisplayTitle(member, fallbackUsername) {
  if (!member) return fallbackUsername || "Dirección General";
  const displayName = member.displayName || member.user?.username || fallbackUsername;
  const highestRole = member.roles.cache
    .filter(r => r.name !== "@everyone" && r.name !== "." && !r.managed)
    .sort((a, b) => b.position - a.position)
    .first();
  return highestRole ? `${displayName} (${highestRole.name})` : displayName;
}

// Crea y configura automáticamente el rol de RRHH en Discord si no existe, y le da permisos en canales/tickets
async function ensureRRHHRole(targetGuild = null) {
  if (!isBotConnected) return null;
  const guild = targetGuild || getPrimaryGuild();
  if (!guild) return null;

  const db = readDb();
  let rrhhRole = db.config.rrhhRoleId
    ? await guild.roles.fetch(db.config.rrhhRoleId).catch(() => null)
    : null;

  if (!rrhhRole) {
    rrhhRole = guild.roles.cache.find(r => {
      const n = r.name.toLowerCase();
      return n.includes("rrhh") || n.includes("recursos humanos");
    });
  }

  if (!rrhhRole) {
    const instructorRole = guild.roles.cache.get("1563509865350168598");
    const targetPosition = instructorRole ? instructorRole.position + 1 : 13;

    rrhhRole = await guild.roles.create({
      name: "💼・Recursos Humanos (RRHH)",
      color: 0x10b981,
      hoist: true,
      mentionable: true,
      position: targetPosition,
      reason: "Creación automática del Departamento de Recursos Humanos (RRHH) — IMPERION Security"
    });

    addFeedEvent(db, "RRHH", `Rol oficial creado y configurado: ${rrhhRole.name}`);
  }

  if (rrhhRole) {
    db.config.rrhhRoleId = rrhhRole.id;
    AUTHORIZED_REVIEWER_ROLE_IDS.add(rrhhRole.id);
    if (!COMPANY_RANK_ROLES.some(r => r.id === rrhhRole.id)) {
      COMPANY_RANK_ROLES.splice(3, 0, { id: rrhhRole.id, name: rrhhRole.name });
    }
    writeDb(db);

    // Configurar permisos del rol RRHH e Instructores en las categorías internas y de oficina
    const categoryIdsToGrant = [
      "1563499611665072240", // OFICINA (Tickets / Soporte)
      "1563511435827482664", // INFORMACION INTERNA
      "1563512435359612939", // CONTROL DE ACTIVIDAD
      "1347330270415683605", // COMUNIDAD
      "1563515173220782080"  // UBICACION
    ];

    for (const catId of categoryIdsToGrant) {
      const cat = guild.channels.cache.get(catId);
      if (cat && cat.permissionOverwrites) {
        await cat.permissionOverwrites
          .edit(rrhhRole.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true
          })
          .catch(() => null);
      }
    }

    // Dar acceso a todos los tickets abiertos actualmente a RRHH e Instructores
    const openTickets = guild.channels.cache.filter(
      c => c.type === ChannelType.GuildText && (c.name.startsWith("postulacion-") || c.name.startsWith("ticket-"))
    );
    for (const [, tCh] of openTickets) {
      await tCh.permissionOverwrites
        .edit(rrhhRole.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        })
        .catch(() => null);
      await tCh.permissionOverwrites
        .edit("1563509865350168598", {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        })
        .catch(() => null);
    }
  }

  return rrhhRole;
}

// Devuelve los canales de texto y roles reales del servidor para los selectores del Dashboard
function getGuildMetadata() {
  const guild = getPrimaryGuild();
  if (!guild) {
    return {
      roles: COMPANY_RANK_ROLES,
      channels: [
        { id: "1563511678254190602", name: "📢┊ᴀɴᴜɴᴄɪᴏs-ɪɴᴛᴇʀɴᴏs" },
        { id: "1347866807205367879", name: "📢┊ᴀɴᴜɴᴄɪᴏs" },
        { id: "1564772258646589641", name: "🥋┊ᴜɴɪғᴏʀᴍᴇ" },
        { id: "1563511968541970513", name: "🗓️┊ʀᴇᴜɴɪᴏɴᴇs" },
        { id: "1564772178371547216", name: "🎊┊ʙᴏɴᴏꜱ" },
        { id: "1564772465819787314", name: "🕰️┊ʀᴇɢɪꜱᴛʀᴏ-ᴅᴇ-ʜᴏʀᴀꜱ" },
        { id: "1564773893883822100", name: "📣┊ᴀᴄᴛɪᴠɪᴅᴀᴅᴇꜱ-ᴅɪꜱᴘᴏɴɪʙʟᴇꜱ" },
        { id: "1347868773914247179", name: "💼┊sᴏᴘᴏʀᴛᴇ" }
      ]
    };
  }

  const excludedRoleNames = [
    "@everyone",
    ".",
    "Empire Securiy Bot",
    "Emperion Security",
    "Bot",
    "BOTS",
    "Tickets Support",
    "Tickets Admin"
  ];

  const roles = guild.roles.cache
    .filter(r => !r.managed && !excludedRoleNames.includes(r.name) && r.position < 41)
    .sort((a, b) => b.position - a.position)
    .map(r => ({
      id: r.id,
      name: r.name,
      position: r.position
    }));

  const channels = guild.channels.cache
    .filter(c => c.type === ChannelType.GuildText)
    .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
    .map(c => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId
    }));

  return {
    roles: roles.length ? roles : COMPANY_RANK_ROLES,
    channels
  };
}

function resolveRoleInGuild(guild, roleIdOrName) {
  if (!guild || !roleIdOrName) return null;
  const byId = guild.roles.cache.get(String(roleIdOrName));
  if (byId) return byId;

  const cleanTarget = String(roleIdOrName).toLowerCase().trim();
  return (
    guild.roles.cache.find(r => r.name.toLowerCase() === cleanTarget) ||
    guild.roles.cache.find(r => r.name.toLowerCase().includes(cleanTarget)) ||
    null
  );
}

async function syncMemberRankRole(userId, roleIdOrName, alsoGiveEmpleados = true) {
  const guild = getPrimaryGuild();
  if (!guild || !userId) return null;

  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return null;

  const db = readDb();
  const targetRole = resolveRoleInGuild(guild, roleIdOrName) || resolveRoleInGuild(guild, db.config.autoRoleApproveId);

  if (targetRole) {
    const rankRoleIds = COMPANY_RANK_ROLES.map(r => r.id).filter(id => id !== targetRole.id);
    for (const oldId of rankRoleIds) {
      if (member.roles.cache.has(oldId)) {
        await member.roles.remove(oldId).catch(() => null);
      }
    }
    await member.roles.add(targetRole.id).catch(() => null);
  }

  if (alsoGiveEmpleados && db.config.empleadosRoleId) {
    await member.roles.add(db.config.empleadosRoleId).catch(() => null);
  }

  return targetRole;
}

// Sincroniza automáticamente a los miembros reales de Discord que tengan rol @Empleados o jerárquico con la pestaña Empleados
async function syncGuildEmployeesToDb() {
  if (!isBotConnected) return { synced: 0, total: 0 };
  const guild = getPrimaryGuild();
  if (!guild) return { synced: 0, total: 0 };

  const db = readDb();

  // Descubrir IDs reales mediante REST sin bloquear por intent privilegiado
  const candidateIds = new Set();
  if (guild.ownerId) candidateIds.add(String(guild.ownerId));
  for (const e of db.employees || []) {
    if (e.discordId && /^\d{16,21}$/.test(String(e.discordId))) candidateIds.add(String(e.discordId));
  }
  for (const a of db.applications || []) {
    if (a.userId && /^\d{16,21}$/.test(String(a.userId))) candidateIds.add(String(a.userId));
  }

  // Escanear últimos mensajes en canales clave para descubrir más miembros activos del servidor
  const scanChannelIds = [
    "1564772465819787314", // #registro-de-horas
    "1564773893883822100", // #actividades-disponibles
    "1563511678254190602", // #anuncios-internos
    "1347868773914247179", // #soporte
    "1564771928407937184"  // #log
  ];
  for (const chId of scanChannelIds) {
    const ch = guild.channels.cache.get(chId);
    if (ch && ch.isTextBased()) {
      const msgs = await ch.messages.fetch({ limit: 25 }).catch(() => null);
      if (msgs) {
        for (const [, m] of msgs) {
          if (m.author && !m.author.bot) candidateIds.add(m.author.id);
          if (m.mentions && m.mentions.users) {
            for (const [uId, u] of m.mentions.users) {
              if (!u.bot) candidateIds.add(uId);
            }
          }
        }
      }
    }
  }

  for (const uid of candidateIds) {
    await guild.members.fetch(uid).catch(() => null);
  }

  const empleadosRoleId = db.config.empleadosRoleId || "1564762865246675074";
  const dutyRoleId = db.config.enServicioRoleId || "1564763063197110372";
  const rrhhRoleId = db.config.rrhhRoleId || "1565722607532253194";

  // Ordenar de mayor a menor jerarquía para detectar el rango más alto de cada empleado
  const orderedHierarchy = [...COMPANY_RANK_ROLES].reverse();
  let addedOrUpdated = 0;

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;

    const isOwner = String(member.id) === String(guild.ownerId);
    const hasEmpleadosRole = member.roles.cache.has(empleadosRoleId);
    const highestCompanyRole = orderedHierarchy.find(r => member.roles.cache.has(r.id));

    if (!isOwner && !hasEmpleadosRole && !highestCompanyRole) continue;

    const mainRole = highestCompanyRole || (isOwner
      ? { id: "1563508474820825138", name: "👑 CEO / Fundador" }
      : { id: "1563510109513195550", name: "🛡️・Agente de Seguridad" });

    const specialRoles = [];
    if (member.roles.cache.has(rrhhRoleId)) specialRoles.push("RRHH");
    if (member.roles.cache.has("1563509865350168598")) specialRoles.push("Instructor");
    if (member.roles.cache.has("1563509992680726608")) specialRoles.push("Evaluador");

    const existing = db.employees.find(
      e => String(e.discordId) === String(member.id) || String(e.id) === String(member.id)
    );

    if (!existing) {
      db.employees.push({
        id: member.id,
        discordId: member.id,
        name: member.displayName || member.user.username,
        discord: `@${member.user.username}`,
        avatar: member.user.displayAvatarURL({ extension: "png", size: 128 }),
        rank: mainRole.name,
        roleId: mainRole.id,
        specialRoles,
        notes: "Sincronizado con Discord",
        sanctionsHistory: [],
        onDuty: member.roles.cache.has(dutyRoleId),
        dutyStart: member.roles.cache.has(dutyRoleId) ? Date.now() : null,
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
      });
      addedOrUpdated++;
    } else {
      existing.discordId = member.id;
      existing.discord = `@${member.user.username}`;
      existing.avatar = member.user.displayAvatarURL({ extension: "png", size: 128 });
      if (highestCompanyRole) {
        existing.rank = highestCompanyRole.name;
        existing.roleId = highestCompanyRole.id;
      }
      existing.specialRoles = specialRoles;
      addedOrUpdated++;
    }
  }

  writeDb(db);
  updateBotPresence();
  return { synced: addedOrUpdated, total: db.employees.length };
}

// Gestionar perfil completo de un empleado y sincronizar sus roles y apodo en Discord en vivo
async function updateEmployeeProfileCore({
  empId,
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
}) {
  const db = readDb();
  const emp = db.employees.find(e => String(e.id) === String(empId) || String(e.discordId) === String(empId));
  if (!emp) throw new Error("Empleado no encontrado en la nómina.");

  const guild = getPrimaryGuild();
  const member = guild && emp.discordId
    ? await guild.members.fetch(String(emp.discordId)).catch(() => null)
    : null;

  // 1. Actualizar Nombre IC y Apodo en Discord
  if (typeof name === "string" && name.trim() && name.trim() !== emp.name) {
    const oldName = emp.name;
    emp.name = name.trim();
    if (member) {
      await member.setNickname(emp.name.slice(0, 32)).catch(() => null);
    }
    addFeedEvent(db, "PERFIL", `${oldName} fue renombrado a ${emp.name} por ${reviewerName || "Dirección"}`);
  }

  // 2. Actualizar Rol Principal en Discord
  if (roleId || rank) {
    const syncedRole = await syncMemberRankRole(emp.discordId, roleId || rank, true).catch(() => null);
    if (syncedRole) {
      emp.rank = syncedRole.name;
      emp.roleId = syncedRole.id;
    } else {
      const meta = getGuildMetadata();
      const found = (meta.roles || []).find(r => r.id === roleId || r.name === rank);
      emp.rank = found ? found.name : (rank || emp.rank);
      if (found) emp.roleId = found.id;
    }
    addFeedEvent(db, "ROL DISCORD", `Rol de ${emp.name} modificado a ${emp.rank} por ${reviewerName || "Dirección"}`);
  }

  // 3. Actualizar Roles Especiales adicionales (RRHH, Instructor, Evaluador) en Discord
  if (Array.isArray(specialRoles)) {
    emp.specialRoles = specialRoles;
    if (member) {
      const rrhhId = db.config.rrhhRoleId || "1565722607532253194";
      const mapSpecial = {
        RRHH: rrhhId,
        Instructor: "1563509865350168598",
        Evaluador: "1563509992680726608"
      };
      for (const [key, rId] of Object.entries(mapSpecial)) {
        if (!rId) continue;
        const shouldHave = specialRoles.includes(key) || emp.roleId === rId;
        if (shouldHave && !member.roles.cache.has(rId)) {
          await member.roles.add(rId).catch(() => null);
        } else if (!shouldHave && member.roles.cache.has(rId) && emp.roleId !== rId) {
          await member.roles.remove(rId).catch(() => null);
        }
      }
    }
  }

  // 4. Actualizar Horas, Bonos, Sanciones, Notas y Asistencia
  if (hours !== undefined && hours !== null && !Number.isNaN(Number(hours))) {
    emp.hours = Math.max(0, Number(Number(hours).toFixed(2)));
  }
  if (bonusExtra !== undefined && bonusExtra !== null && !Number.isNaN(Number(bonusExtra))) {
    emp.bonusExtra = Math.max(0, Number(bonusExtra));
  }
  if (warnings !== undefined && warnings !== null && !Number.isNaN(Number(warnings))) {
    emp.warnings = Math.max(0, Number(warnings));
  }
  if (typeof notes === "string") {
    emp.notes = notes.trim();
  }
  if (attendance) {
    emp.attendance = attendance;
  }

  writeDb(db);
  return emp;
}

// Sancionar a un empleado con motivo: registra en legajo, envía MD al empleado y publica en #log
async function sanctionEmployeeCore({ empId, reason, reviewerName }) {
  const db = readDb();
  const emp = db.employees.find(e => String(e.id) === String(empId) || String(e.discordId) === String(empId));
  if (!emp) throw new Error("Empleado no encontrado.");

  const cleanReason = (reason || "Incumplimiento de normativa interna de IMPERION Security.").trim();
  const officialReviewer = reviewerName || "Dirección / RRHH";

  emp.warnings = (emp.warnings || 0) + 1;
  if (!Array.isArray(emp.sanctionsHistory)) emp.sanctionsHistory = [];
  emp.sanctionsHistory.unshift({
    date: new Date().toLocaleString("es-AR", { hour12: false }),
    reason: cleanReason,
    by: officialReviewer,
    warningCount: emp.warnings
  });

  addFeedEvent(db, "SANCIÓN", `${emp.name} recibió sanción (${emp.warnings}/3) de ${officialReviewer}: "${cleanReason}"`);
  writeDb(db);

  let dmSent = false;
  if (isBotConnected && emp.discordId) {
    const userObj = await client.users.fetch(String(emp.discordId)).catch(() => null);
    if (userObj) {
      const dmEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("⚠️ NOTIFICACIÓN DE SANCIÓN DISCIPLINARIA | IMPERION SECURITY")
        .setDescription(
          `Hola **${emp.name}**, el Departamento de **Recursos Humanos y Dirección** de **IMPERION Security** ha registrado un apercibimiento en tu legajo oficial.`
        )
        .addFields(
          { name: "👮 Agente", value: `${emp.name} (${emp.rank})`, inline: true },
          { name: "⚠️ Sanciones Acumuladas", value: `**${emp.warnings} / 3**`, inline: true },
          { name: "🎖️ Emitida por", value: officialReviewer, inline: true },
          { name: "📋 Motivo de la Sanción", value: cleanReason, inline: false }
        )
        .setFooter({ text: "IMPERION Security • Recordá que acumular 3/3 sanciones es causal de baja inmediata" })
        .setTimestamp();

      const sent = await userObj.send({ embeds: [dmEmbed] }).catch(() => null);
      if (sent) dmSent = true;
    }

    const logChannelId = db.config.logsChannelId || "1564771928407937184";
    const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("⚠️ LOG DE SANCIÓN DISCIPLINARIA | IMPERION SECURITY")
        .addFields(
          { name: "👮 Empleado", value: `**${emp.name}** (<@${emp.discordId}>)`, inline: true },
          { name: "🎖️ Rol Actual", value: emp.rank, inline: true },
          { name: "⚠️ Estado Legajo", value: `**${emp.warnings}/3 Sanciones**`, inline: true },
          { name: "📋 Motivo", value: cleanReason, inline: false },
          { name: "🛡️ Sancionado por", value: officialReviewer, inline: true },
          { name: "📩 Notificación MD", value: dmSent ? "✅ Enviada al privado" : "⚠️ MD cerrado", inline: true }
        )
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
    }
  }

  return { emp, dmSent };
}

// Despedir / Expulsar a un empleado por X motivo: envía MD con motivo, quita roles de Discord (o Kick) y manda log a #despedido
async function fireEmployeeCore({ empId, reason, kickFromServer = false, reviewerName }) {
  const db = readDb();
  const emp = db.employees.find(e => String(e.id) === String(empId) || String(e.discordId) === String(empId));
  if (!emp) throw new Error("Empleado no encontrado en la nómina.");

  const cleanReason = (reason || "Baja dispuesta por la Dirección / RRHH de IMPERION Security.").trim();
  const officialReviewer = reviewerName || "Dirección / RRHH";
  const guild = getPrimaryGuild();

  let dmSent = false;
  let rolesRemoved = false;
  let kicked = false;

  // 1. Enviar Carta de Despido al MD ANTES de quitar roles o expulsar (para asegurar entrega en Discord)
  if (isBotConnected && emp.discordId) {
    const userObj = await client.users.fetch(String(emp.discordId)).catch(() => null);
    if (userObj) {
      const logoPath = getLogoAttachmentPath();
      const files = logoPath ? [new AttachmentBuilder(logoPath, { name: "logo.jpg" })] : [];

      const dmEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("🚫 NOTIFICACIÓN OFICIAL DE DESPIDO / BAJA | IMPERION SECURITY")
        .setDescription(
          `Hola **${emp.name}**, te informamos que a partir de este momento has sido **dado/a de baja de la plantilla de IMPERION Security**.`
        )
        .addFields(
          { name: "👤 Ex-Agente", value: emp.name, inline: true },
          { name: "🎖️ Último Rango", value: emp.rank, inline: true },
          { name: "🛡️ Autorizado por", value: officialReviewer, inline: true },
          { name: "📋 Motivo del Despido / Baja", value: cleanReason, inline: false },
          {
            name: "🏢 Devolución de Equipo",
            value: "Tus credenciales operativas y permisos de acceso a los canales internos de la empresa han sido revocados automáticamente."
          }
        )
        .setFooter({ text: "Departamento de Recursos Humanos & Dirección • IMPERION Security" })
        .setTimestamp();

      if (logoPath) dmEmbed.setThumbnail("attachment://logo.jpg");

      const sent = await userObj.send({ embeds: [dmEmbed], files }).catch(() => null);
      if (sent) dmSent = true;
    }

    // 2. Quitar todos los roles de la empresa en Discord o expulsar del servidor (Kick)
    if (guild) {
      const member = await guild.members.fetch(String(emp.discordId)).catch(() => null);
      if (member) {
        if (kickFromServer) {
          const kickRes = await member
            .kick(`Despedido por ${officialReviewer}: ${cleanReason}`)
            .then(() => true)
            .catch(() => false);
          kicked = kickRes;
        }

        if (!kicked) {
          const rolesToRemove = new Set([
            ...COMPANY_RANK_ROLES.map(r => r.id),
            db.config.empleadosRoleId || "1564762865246675074",
            db.config.enServicioRoleId || "1564763063197110372",
            db.config.rrhhRoleId || "1565722607532253194",
            "1563509865350168598", // Instructor
            "1563509992680726608"  // Evaluador
          ]);

          for (const rId of rolesToRemove) {
            if (rId && member.roles.cache.has(rId)) {
              await member.roles.remove(rId).catch(() => null);
            }
          }

          // Dejarle rol Ciudadano si existe en el servidor
          if (guild.roles.cache.has("1564762950974181436")) {
            await member.roles.add("1564762950974181436").catch(() => null);
          }
          rolesRemoved = true;
        }
      }
    }

    // 3. Publicar Log Oficial de Despido en #🛫┊ᴅᴇsᴘᴇᴅɪᴅᴏ (1347329483975164046) y en #📓┊ʟᴏɢ
    const despedidoChannelId = db.config.despedidoChannelId || "1347329483975164046";
    const logChannelId = db.config.logsChannelId || "1564771928407937184";

    const fireLogEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("🛫 REGISTRO OFICIAL DE BAJA / DESPIDO | IMPERION SECURITY")
      .addFields(
        { name: "👤 Ex-Empleado", value: `**${emp.name}** (<@${emp.discordId}> • \`${emp.discord}\`)`, inline: true },
        { name: "🎖️ Cargo que ocupaba", value: emp.rank, inline: true },
        { name: "🛡️ Ejecutado por", value: officialReviewer, inline: true },
        { name: "📋 Motivo del Despido", value: cleanReason, inline: false },
        {
          name: "⚙️ Acción en Discord",
          value: kicked
            ? "🚪 Expulsado del servidor de Discord (Kick)"
            : rolesRemoved
            ? "🔄 Roles de empresa retirados (Asignado @Ciudadano)"
            : "📋 Baja administrativa de nómina",
          inline: true
        },
        {
          name: "📩 Notificación por MD",
          value: dmSent ? "✅ Carta de despido enviada al MD" : "⚠️ No se pudo entregar MD (Privado cerrado)",
          inline: true
        }
      )
      .setFooter({ text: "IMPERION Security • Auditoría de Recursos Humanos" })
      .setTimestamp();

    const chDesp = await client.channels.fetch(despedidoChannelId).catch(() => null);
    if (chDesp) await chDesp.send({ embeds: [fireLogEmbed] }).catch(() => null);

    if (logChannelId && logChannelId !== despedidoChannelId) {
      const chLog = await client.channels.fetch(logChannelId).catch(() => null);
      if (chLog) await chLog.send({ embeds: [fireLogEmbed] }).catch(() => null);
    }
  }

  // 4. Eliminar de la nómina activa y guardar en historial de eventos
  db.employees = db.employees.filter(e => String(e.id) !== String(emp.id));
  addFeedEvent(
    db,
    "DESPIDO",
    `${emp.name} (${emp.rank}) fue despedido por ${officialReviewer} — Motivo: "${cleanReason}"`
  );
  writeDb(db);
  updateBotPresence();

  return {
    firedName: emp.name,
    dmSent,
    rolesRemoved,
    kicked
  };
}

async function syncMemberDutyRole(userId, onDuty) {
  const guild = getPrimaryGuild();
  if (!guild || !userId) return;
  const db = readDb();
  const dutyRoleId = db.config.enServicioRoleId || "1564763063197110372";
  if (!dutyRoleId) return;

  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return;

  if (onDuty) {
    await member.roles.add(dutyRoleId).catch(() => null);
  } else {
    await member.roles.remove(dutyRoleId).catch(() => null);
  }
}

function updateBotPresence() {
  if (!isBotConnected || !client.user) return;
  const db = readDb();
  const activeCount = db.employees.filter(e => e.onDuty).length;
  const statusText = activeCount > 0
    ? `🛡️ ${activeCount} Agente(s) en Servicio | IMPERION`
    : `🛡️ IMPERION Security | GTAHub Orion`;

  client.user.setPresence({
    activities: [{ name: statusText, type: ActivityType.Watching }],
    status: "online"
  });
  updateServerCounterChannels().catch(() => null);
}

async function updateServerCounterChannels() {
  if (!isBotConnected) return;
  const db = readDb();
  const totalEmp = db.employees.length;
  const inService = db.employees.filter(e => e.onDuty).length;

  if (db.config.counterEmpleadosChannelId) {
    const chEmp = await client.channels.fetch(db.config.counterEmpleadosChannelId).catch(() => null);
    if (chEmp) await chEmp.setName(`👮 Empleados: ${totalEmp}`).catch(() => null);
  }

  if (db.config.counterServicioChannelId) {
    const chSrv = await client.channels.fetch(db.config.counterServicioChannelId).catch(() => null);
    if (chSrv) await chSrv.setName(`🟢 En Servicio: ${inService}`).catch(() => null);
  }
}

async function createServerCounterChannels(targetGuild = null) {
  if (!isBotConnected) return false;
  const guild = targetGuild || getPrimaryGuild();
  if (!guild) return false;

  const db = readDb();
  const totalEmp = db.employees.length;
  const inService = db.employees.filter(e => e.onDuty).length;

  let chEmp = db.config.counterEmpleadosChannelId
    ? await guild.channels.fetch(db.config.counterEmpleadosChannelId).catch(() => null)
    : null;
  if (!chEmp) {
    chEmp = await guild.channels.create({
      name: `👮 Empleados: ${totalEmp}`,
      type: ChannelType.GuildVoice,
      position: 0,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.Connect], allow: [PermissionFlagsBits.ViewChannel] }
      ]
    });
    db.config.counterEmpleadosChannelId = chEmp.id;
  } else {
    await chEmp.setName(`👮 Empleados: ${totalEmp}`).catch(() => null);
  }

  let chSrv = db.config.counterServicioChannelId
    ? await guild.channels.fetch(db.config.counterServicioChannelId).catch(() => null)
    : null;
  if (!chSrv) {
    chSrv = await guild.channels.create({
      name: `🟢 En Servicio: ${inService}`,
      type: ChannelType.GuildVoice,
      position: 1,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.Connect], allow: [PermissionFlagsBits.ViewChannel] }
      ]
    });
    db.config.counterServicioChannelId = chSrv.id;
  } else {
    await chSrv.setName(`🟢 En Servicio: ${inService}`).catch(() => null);
  }

  writeDb(db);
  return true;
}

async function ensureApplicationLogChannels(targetGuild = null) {
  if (!isBotConnected) return null;
  const guild = targetGuild || getPrimaryGuild();
  if (!guild) return null;

  const db = readDb();
  let changed = false;

  const parentCatId =
    guild.channels.cache.has("1563499611665072240")
      ? "1563499611665072240"
      : guild.channels.cache.has("1564771603194056774")
      ? "1564771603194056774"
      : null;

  let chAprobadas = db.config.logAprobadasChannelId
    ? await guild.channels.fetch(db.config.logAprobadasChannelId).catch(() => null)
    : null;

  if (!chAprobadas) {
    chAprobadas = guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && (c.name.includes("aprobada") || c.name.includes("ᴀᴘʀᴏʙᴀᴅᴀ"))
    );
  }

  if (!chAprobadas) {
    chAprobadas = await guild.channels.create({
      name: "✅┊ᴘᴏsᴛᴜʟᴀᴄɪᴏɴᴇs-ᴀᴘʀᴏʙᴀᴅᴀs",
      type: ChannelType.GuildText,
      parent: parentCatId,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages]
        }
      ]
    });
    changed = true;
  }

  if (chAprobadas && db.config.logAprobadasChannelId !== chAprobadas.id) {
    db.config.logAprobadasChannelId = chAprobadas.id;
    changed = true;
  }

  let chRechazadas = db.config.logRechazadasChannelId
    ? await guild.channels.fetch(db.config.logRechazadasChannelId).catch(() => null)
    : null;

  if (!chRechazadas) {
    chRechazadas = guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && (c.name.includes("rechazada") || c.name.includes("ʀᴇᴄʜᴀᴢᴀᴅᴀ"))
    );
  }

  if (!chRechazadas) {
    chRechazadas = await guild.channels.create({
      name: "❌┊ᴘᴏsᴛᴜʟᴀᴄɪᴏɴᴇs-ʀᴇᴄʜᴀᴢᴀᴅᴀs",
      type: ChannelType.GuildText,
      parent: parentCatId,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages]
        }
      ]
    });
    changed = true;
  }

  if (chRechazadas && db.config.logRechazadasChannelId !== chRechazadas.id) {
    db.config.logRechazadasChannelId = chRechazadas.id;
    changed = true;
  }

  if (changed) {
    addFeedEvent(
      db,
      "LOGS",
      `Canales de logs activos: #${chAprobadas?.name || "aprobadas"} y #${chRechazadas?.name || "rechazadas"}`
    );
    writeDb(db);
  }

  return {
    logAprobadasChannelId: db.config.logAprobadasChannelId,
    logRechazadasChannelId: db.config.logRechazadasChannelId
  };
}

function startAntiFarmingMonitor() {
  setInterval(async () => {
    if (!isBotConnected) return;
    const db = readDb();
    const limitHours = 5;
    const warnMs = limitHours * 60 * 60 * 1000;
    const maxMs = (limitHours + 0.25) * 60 * 60 * 1000;
    let changed = false;

    for (const emp of db.employees) {
      if (!emp.onDuty || !emp.dutyStart) continue;
      const elapsedMs = Date.now() - emp.dutyStart;

      if (elapsedMs >= warnMs && elapsedMs < maxMs && !emp.warnedAFK) {
        emp.warnedAFK = true;
        changed = true;
        const userObj = await client.users.fetch(emp.discordId).catch(() => null);
        if (userObj) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("keep_duty_alive")
              .setLabel("🟢 Sí, sigo en servicio")
              .setStyle(ButtonStyle.Success)
          );
          await userObj
            .send({
              content:
                `⏱️ **Control Anti-AFK | IMPERION Security**\n` +
                `Acabás de cumplir **5 horas seguidas** con el turno abierto en \`/clock\`. ` +
                `Si seguís trabajando en el servidor, tocá el botón debajo en los próximos 15 minutos o tu turno se cerrará automáticamente.`,
              components: [row]
            })
            .catch(() => null);
        }
      }

      if (elapsedMs >= maxMs) {
        emp.onDuty = false;
        emp.dutyStart = null;
        emp.warnedAFK = false;
        emp.hours = Number((emp.hours + limitHours).toFixed(2));
        emp.totalHours = Number(((emp.totalHours || 0) + limitHours).toFixed(2));
        addFeedEvent(db, "ANTI-AFK", `Turno de ${emp.name} cerrado automáticamente tras superar 5h sin respuesta`);
        changed = true;
        syncMemberDutyRole(emp.discordId, false).catch(() => null);

        const userObj = await client.users.fetch(emp.discordId).catch(() => null);
        if (userObj) {
          await userObj
            .send({
              content:
                `🔴 **Turno Cerrado Automáticamente | IMPERION Security**\n` +
                `Cumpliste más de **5 horas continuas** sin confirmar actividad y tu turno fue cerrado automáticamente (+**5.0h** acreditadas en tu legajo).\n` +
                `*Si continuás en servicio dentro del servidor, podés volver a fichar Entrada en #clock.*`
            })
            .catch(() => null);
        }
      }
    }

    if (changed) {
      writeDb(db);
      updateBotPresence();
    }
  }, 60 * 1000);
}

// ============================================================================
// DEFINICIÓN DE COMANDOS SLASH (/)
// ============================================================================
const commands = [
  new SlashCommandBuilder()
    .setName("clock")
    .setDescription("Despliega el panel interactivo de fichaje de horas (Entrada/Salida/Estadísticas)"),

  new SlashCommandBuilder()
    .setName("mi-acceso")
    .setDescription("Genera tu Código de Seguridad para entrar al Panel Web (RRHH, Instructores y Cúpula)")
    .addStringOption(o =>
      o
        .setName("nombre_ic")
        .setDescription("Tu Nombre y Apellido dentro del juego (IC)")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("actividad")
    .setDescription("Publica inmediatamente una actividad oficial en el canal de actividades")
    .addStringOption(opt =>
      opt
        .setName("tipo")
        .setDescription("Selecciona la actividad de GTAHub Orion")
        .setRequired(true)
        .addChoices(
          { name: "REABASTECER CAJEROS #4", value: "atm|REABASTECER CAJEROS #4" },
          { name: "INSTALACIÓN DE ALARMAS #1", value: "alarm|INSTALACIÓN DE ALARMAS #1" },
          { name: "REPARACIÓN DE CÁMARAS #3", value: "cam|REPARACIÓN DE CÁMARAS #3" },
          { name: "SERVICIO DE ESCOLTA #3", value: "escort|SERVICIO DE ESCOLTA #3" },
          { name: "REVISIÓN DE SEGURIDAD #1", value: "rev|REVISIÓN DE SEGURIDAD #1" }
        )
    ),

  new SlashCommandBuilder()
    .setName("reunion")
    .setDescription("Convoca una reunión oficial con botones de confirmación y justificación de ausencia")
    .addStringOption(o => o.setName("fecha_hora").setDescription("Ej: Hoy 22:00hs").setRequired(true))
    .addStringOption(o => o.setName("tema").setDescription("Motivo o puntos a tratar en la reunión").setRequired(true)),

  new SlashCommandBuilder()
    .setName("bono")
    .setDescription("Otorga un bono monetario a un empleado y lo publica en #bonos")
    .addUserOption(o => o.setName("empleado").setDescription("Empleado que recibe el bono").setRequired(true))
    .addIntegerOption(o => o.setName("monto").setDescription("Monto en dólares IC (Ej: 5000)").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo del bono").setRequired(true)),

  new SlashCommandBuilder()
    .setName("contratar")
    .setDescription("Da de alta a un empleado, le asigna el rol elegido + @Empleados y cambia su apodo IC")
    .addUserOption(o => o.setName("usuario").setDescription("Usuario de Discord").setRequired(true))
    .addStringOption(o => o.setName("nombre_ic").setDescription("Nombre y Apellido IC").setRequired(true))
    .addRoleOption(o => o.setName("rol").setDescription("Seleccioná el rol del servidor a asignarle").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ascender")
    .setDescription("Actualiza el rol jerárquico de un empleado en Discord y en el Dashboard")
    .addUserOption(o => o.setName("empleado").setDescription("Empleado a promover/modificar").setRequired(true))
    .addRoleOption(o => o.setName("nuevo_rol").setDescription("Nuevo rol jerárquico del servidor").setRequired(true)),

  new SlashCommandBuilder()
    .setName("sancionar")
    .setDescription("Registra una sanción disciplinaria en el legajo del empleado")
    .addUserOption(o => o.setName("empleado").setDescription("Empleado sancionado").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo de la sanción").setRequired(true)),

  new SlashCommandBuilder()
    .setName("despedir")
    .setDescription("Da de baja a un empleado del sistema y retira sus roles de empresa")
    .addUserOption(o => o.setName("empleado").setDescription("Empleado a dar de baja").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo de la baja").setRequired(true)),

  new SlashCommandBuilder()
    .setName("legajo")
    .setDescription("Consulta el expediente completo de horas, actividades, bonos y sanciones de un agente")
    .addUserOption(o => o.setName("empleado").setDescription("Empleado a consultar (opcional)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("comunicado")
    .setDescription("Publica un comunicado oficial con formato institucional de IMPERION Security")
    .addStringOption(o => o.setName("titulo").setDescription("Título del anuncio").setRequired(true))
    .addStringOption(o => o.setName("mensaje").setDescription("Contenido del comunicado").setRequired(true))
    .addStringOption(o => o.setName("imagen_url").setDescription("URL de imagen adjunta (opcional)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("panel-tickets")
    .setDescription("Despliega el panel fijo de Tickets (Postulaciones, Contratar Seguridad y Soporte)"),

  new SlashCommandBuilder()
    .setName("crear-contadores")
    .setDescription("Crea o actualiza canales contadores, rol RRHH y canales de logs de postulaciones")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("configurar-canales")
    .setDescription("Configura fácilmente los canales, logs y autorol de aprobación del servidor")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o => o.setName("autorol_aprobacion").setDescription("Rol por defecto al aprobar postulación").setRequired(false))
    .addRoleOption(o => o.setName("rol_empleados").setDescription("Rol general @Empleados").setRequired(false))
    .addChannelOption(o => o.setName("log_aprobadas").setDescription("Canal de logs de postulaciones aprobadas").setRequired(false))
    .addChannelOption(o => o.setName("log_rechazadas").setDescription("Canal de logs de postulaciones rechazadas").setRequired(false))
    .addChannelOption(o => o.setName("canal_clock").setDescription("Canal para fichaje /clock").setRequired(false))
    .addChannelOption(o => o.setName("canal_actividades").setDescription("Canal #actividades-disponibles").setRequired(false))
    .addChannelOption(o => o.setName("canal_bonos").setDescription("Canal #bonos").setRequired(false))
].map(c => c.toJSON());

// ============================================================================
// CONSTRUCTORES DE PANELES E INTERFACES
// ============================================================================
function buildClockComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("clock_in")
      .setLabel("Entrada")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("clock_out")
      .setLabel("Salida")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("clock_active")
      .setLabel("Trabajando actualmente")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("clock_total")
      .setLabel("Mi Tiempo Total")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("clock_stats")
      .setLabel("📊 Mis Estadísticas")
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("clock_admin")
      .setLabel("Panel de Administración")
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

function buildMeetingEmbed(fechaHora, tema, db) {
  const confirmados = db.employees.filter(e => e.attendance === "Confirmado");
  const ausentes = db.employees.filter(e => e.attendance === "Ausente");

  const listConfirmados = confirmados.length
    ? confirmados.map(e => `• **${e.name}** (${e.rank})`).join("\n")
    : "*Sin confirmaciones aún*";

  const listAusentes = ausentes.length
    ? ausentes.map(e => `• **${e.name}** — *Motivo: ${e.reason || "Sin especificar"}*`).join("\n")
    : "*Sin ausencias registradas*";

  return new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle("📅 CONVOCATORIA DE REUNIÓN OFICIAL | IMPERION SECURITY")
    .setDescription(
      `Se convoca a todo el personal de **IMPERION Security** a la reunión programada.\n\n` +
      `🕒 **Fecha y Hora:** ${fechaHora}\n` +
      `📌 **Temario:** ${tema}\n\n` +
      `Por favor, seleccionen una opción debajo para confirmar su asistencia o justificar su inasistencia.`
    )
    .addFields(
      { name: `✅ Asistirán (${confirmados.length})`, value: listConfirmados, inline: false },
      { name: `❌ No pueden asistir (${ausentes.length})`, value: listAusentes, inline: false }
    )
    .setFooter({ text: "IMPERION Security • Control de Asistencia en Tiempo Real" })
    .setTimestamp();
}

function buildMeetingButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("meeting_confirm")
      .setLabel("Confirmar Asistencia")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("meeting_absent")
      .setLabel("No puedo asistir (Justificar)")
      .setStyle(ButtonStyle.Danger)
  );
}

// ============================================================================
// FLUJO DE APROBACIÓN Y RECHAZO DE POSTULACIONES + LOGS EN CANALES DEDICADOS
// ============================================================================
async function approveApplicationCore({
  appId,
  guildId,
  channelId,
  userId,
  nombreIc,
  roleId,
  rango,
  giveEmpleadosRole,
  reviewerName = "Dirección General"
}) {
  const guild = guildId
    ? await client.guilds.fetch(guildId).catch(() => getPrimaryGuild())
    : getPrimaryGuild();

  await ensureApplicationLogChannels(guild).catch(() => null);
  const freshDb = readDb();

  const member = guild ? await guild.members.fetch(String(userId)).catch(() => null) : null;
  const username = member?.user?.username || "agente";

  const appItem = appId
    ? freshDb.applications.find(a => String(a.id) === String(appId))
    : freshDb.applications.find(a => a.userId === String(userId) && a.status === "Pendiente");

  const rawName = nombreIc || appItem?.nombreHash || username;
  const cleanName = rawName.split("|")[0].trim() || username;

  const targetRoleKey = roleId || rango || freshDb.config.autoRoleApproveId || "1563510109513195550";
  const resolvedRole = guild ? resolveRoleInGuild(guild, targetRoleKey) : null;
  const finalRoleName = resolvedRole ? resolvedRole.name : (rango || "🛡️・Agente de Seguridad");
  const finalRoleId = resolvedRole ? resolvedRole.id : "1563510109513195550";

  const emp = findOrCreateEmployee(freshDb, userId, username, cleanName);
  emp.name = cleanName;
  emp.rank = finalRoleName;
  emp.roleId = finalRoleId;

  if (appItem) {
    appItem.status = "Aprobado";
    appItem.approvedRole = finalRoleName;
    appItem.approvedBy = reviewerName;
  }

  addFeedEvent(freshDb, "ALTA", `${cleanName} aprobado con autorol ${finalRoleName} por ${reviewerName}`);
  writeDb(freshDb);
  updateBotPresence();

  const shouldGiveEmpleados =
    giveEmpleadosRole !== undefined ? Boolean(giveEmpleadosRole) : freshDb.config.giveEmpleadosRoleOnApprove !== false;

  if (member && guild) {
    await syncMemberRankRole(userId, finalRoleId, shouldGiveEmpleados).catch(() => null);
    await member.setNickname(cleanName).catch(() => null);
  }

  // Enviar Log al canal #postulaciones-aprobadas
  const logChannelId = freshDb.config.logAprobadasChannelId;
  if (logChannelId && isBotConnected) {
    const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
    if (logChannel) {
      const rolesMentionText = shouldGiveEmpleados && freshDb.config.empleadosRoleId && freshDb.config.empleadosRoleId !== finalRoleId
        ? `<@&${finalRoleId}> + <@&${freshDb.config.empleadosRoleId}>`
        : `<@&${finalRoleId}>`;

      const approvedLogEmbed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle("✅ POSTULACIÓN APROBADA | IMPERION SECURITY")
        .setDescription(
          `Se ha aprobado una nueva solicitud de ingreso a **IMPERION Security** y se otorgaron los permisos correspondientes.`
        )
        .addFields(
          { name: "👤 Postulante", value: `<@${userId}> (\`${appItem?.discordTag || username}\`)`, inline: true },
          { name: "🪪 Nombre IC | HASH", value: `**${appItem?.nombreHash || cleanName}**`, inline: true },
          { name: "🎖️ Autorol Asignado", value: rolesMentionText, inline: true },
          { name: "🕒 Disponibilidad", value: appItem?.disponibilidad || "No especificada", inline: true },
          { name: "📍 Datos declarados", value: appItem?.datosPersonales || "Ver expediente", inline: true },
          { name: "🛡️ Aprobado por", value: `**${reviewerName}**`, inline: true }
        )
        .setFooter({ text: "IMPERION Security • Departamento de RRHH, Instructores y Dirección" })
        .setTimestamp();

      await logChannel.send({
        content: `🎉 Bienvenido/a <@${userId}> a **IMPERION Security**!`,
        embeds: [approvedLogEmbed]
      }).catch(() => null);
    }
  }

  // Enviar Instructivo Oficial al Privado (MD)
  const instructivoEmbed = new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle("🛡️ ¡BIENVENIDO A IMPERION SECURITY! — INSTRUCTIVO OFICIAL")
    .setDescription(
      `Hola **${cleanName}**, tu postulación fue **APROBADA** por **${reviewerName}**.\n` +
      `Se te asignó el rol de **${finalRoleName}**.\n\n` +
      `### 📋 INSTRUCTIVO DE TRABAJO:\n` +
      `1. **⏱️ Fichaje de Horas (\`/clock\`):**\n` +
      `   Antes de comenzar tu servicio en **#registro-de-horas**, tocá el botón verde **Entrada** (se te asignará el rol *En servicio*). Al terminar, recordá tocar **Salida** para computar tus horas.\n\n` +
      `2. **👕 Uniforme Reglamentario (Tienda Krapea):**\n` +
      `   • **Camisa:** Sueter camisa (Color 0)\n` +
      `   • **Pantalón:** Jean negro ajustado (Color 0)\n` +
      `   *Es obligatorio acudir a todos los servicios correctamente uniformado.*\n\n` +
      `3. **🚨 Actividades Disponibles y Bonos:**\n` +
      `   En **#actividades-disponibles** el bot publica automáticamente las actividades del servidor (*Cajeros, Alarmas, Cámaras, Escolta y Revisión*). Al completar una, tocá **Certificar Actividad Realizada** para sumar la comisión a tu bono semanal.\n\n` +
      `4. **📅 Reuniones:**\n` +
      `   Revisá periódicamente **#reuniones** y confirmá tu asistencia con los botones interactivos.`
    )
    .setFooter({ text: "IMPERION Security • Protegiendo lo que importa" })
    .setTimestamp();

  if (member) {
    await member.send({ embeds: [instructivoEmbed] }).catch(() => null);
  } else {
    const userObj = await client.users.fetch(String(userId)).catch(() => null);
    if (userObj) await userObj.send({ embeds: [instructivoEmbed] }).catch(() => null);
  }

  const targetChannelId = channelId || appItem?.ticketChannelId;
  if (targetChannelId) {
    const ticketChannel = await client.channels.fetch(targetChannelId).catch(() => null);
    if (ticketChannel) {
      await ticketChannel
        .send({
          content:
            `✅ **Postulación Aprobada por ${reviewerName}.** Se asignó el rol **${finalRoleName}** a <@${userId}>, ` +
            `se registró en <#${freshDb.config.logAprobadasChannelId}>, se envió el **Instructivo Oficial por MD** y este ticket se cerrará en 5 segundos.`
        })
        .catch(() => null);
      setTimeout(() => {
        ticketChannel.delete().catch(() => null);
      }, 5000);
    }
  }

  return emp;
}

async function rejectApplicationCore({
  appId,
  guildId,
  channelId,
  userId,
  reason,
  reviewerName = "Dirección General"
}) {
  const guild = guildId
    ? await client.guilds.fetch(guildId).catch(() => getPrimaryGuild())
    : getPrimaryGuild();

  await ensureApplicationLogChannels(guild).catch(() => null);
  const db = readDb();

  const appItem = appId
    ? db.applications.find(a => String(a.id) === String(appId))
    : db.applications.find(a => a.userId === String(userId) && a.status === "Pendiente");

  const finalReason = reason || "No cumple con los requisitos actuales de la empresa.";
  if (appItem) {
    appItem.status = "Rechazado";
    appItem.rejectReason = finalReason;
    appItem.rejectedBy = reviewerName;
  }

  addFeedEvent(db, "RECHAZO", `Postulación de ${appItem?.nombreHash || userId} rechazada por ${reviewerName} (${finalReason})`);
  writeDb(db);

  // Enviar Log al canal #postulaciones-rechazadas
  const logChannelId = db.config.logRechazadasChannelId;
  if (logChannelId && isBotConnected) {
    const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
    if (logChannel) {
      const rejectedLogEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle("❌ POSTULACIÓN RECHAZADA | IMPERION SECURITY")
        .setDescription(
          `Una solicitud de ingreso ha sido evaluada y rechazada por el equipo de evaluación.`
        )
        .addFields(
          { name: "👤 Postulante", value: `<@${userId}> (\`${appItem?.discordTag || userId}\`)`, inline: true },
          { name: "🪪 Nombre IC | HASH", value: `**${appItem?.nombreHash || "No especificado"}**`, inline: true },
          { name: "🛡️ Evaluado por", value: `**${reviewerName}**`, inline: true },
          { name: "📌 Motivo del Rechazo", value: `> ${finalReason}`, inline: false }
        )
        .setFooter({ text: "IMPERION Security • Departamento de RRHH, Instructores y Dirección" })
        .setTimestamp();

      await logChannel.send({ embeds: [rejectedLogEmbed] }).catch(() => null);
    }
  }

  const rejectEmbed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle("🛡️ ESTADO DE TU POSTULACIÓN | IMPERION SECURITY")
    .setDescription(
      `Hola <@${userId}>, te informamos que tu solicitud de ingreso a **IMPERION Security** fue revisada por **${reviewerName}** y en esta ocasión **no fue aprobada**.\n\n` +
      `📌 **Motivo indicado:**\n> ${finalReason}\n\n` +
      `Agradecemos tu interés y tiempo.`
    )
    .setFooter({ text: "IMPERION Security • Departamento de Recursos Humanos" })
    .setTimestamp();

  const userObj = await client.users.fetch(String(userId)).catch(() => null);
  if (userObj) {
    await userObj.send({ embeds: [rejectEmbed] }).catch(() => null);
  }

  const targetChannelId = channelId || appItem?.ticketChannelId;
  if (targetChannelId) {
    const ticketChannel = await client.channels.fetch(targetChannelId).catch(() => null);
    if (ticketChannel) {
      await ticketChannel
        .send({
          content:
            `❌ **Postulación Rechazada por ${reviewerName}.** Se registró en <#${db.config.logRechazadasChannelId}> ` +
            `y se notificó por privado a <@${userId}> (Motivo: *${finalReason}*). Cerrando ticket en 5 segundos...`
        })
        .catch(() => null);
      setTimeout(() => {
        ticketChannel.delete().catch(() => null);
      }, 5000);
    }
  }
  return true;
}

// ============================================================================
// ENVÍO DE ACTIVIDADES, COMUNICADOS, REUNIONES Y PANELES A DISCORD
// ============================================================================
async function sendActivityToDiscord(title, key, targetChannel = null) {
  const db = readDb();
  const channelId = db.config.actividadesChannelId || process.env.CHANNEL_ACTIVIDADES_ID || "1564773893883822100";
  let roleId = db.config.empleadosRoleId || process.env.ROLE_EMPLEADOS_ID || "1564762865246675074";

  let channel = targetChannel;
  if (!channel && isBotConnected && channelId) {
    channel = await client.channels.fetch(channelId).catch(() => null);
  }
  if (!channel) return false;

  if (!roleId && channel.guild) {
    const foundRole = channel.guild.roles.cache.find(r => r.name.toLowerCase().includes("empleado"));
    if (foundRole) roleId = foundRole.id;
  }

  const mention = roleId ? `<@&${roleId}>` : "@Empleados";
  const fileName = `${key}.jpg`;
  const localFilePath = path.join(__dirname, "..", "public", "assets", "activities", fileName);

  const embed = new EmbedBuilder().setColor(0x1d4ed8);
  const files = [];

  if (fs.existsSync(localFilePath)) {
    files.push(new AttachmentBuilder(localFilePath, { name: fileName }));
    embed.setImage(`attachment://${fileName}`);
  } else {
    embed.setImage(getActivityImageUrl(key));
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_activity_${key}_${title}`)
      .setLabel("Certificar Actividad Realizada")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({
    content: `${mention} | ${title}`,
    embeds: [embed],
    files,
    components: [row]
  });
  return true;
}

async function sendComunicadoToDiscord({ channelId, channelName, title, message, mention, imageUrl }) {
  if (!isBotConnected) throw new Error("El bot aún no está conectado a Discord.");
  const db = readDb();
  const guild = getPrimaryGuild();

  let channel = null;

  if (channelId) {
    channel = await client.channels.fetch(String(channelId)).catch(() => null);
  }

  if (!channel && channelName && guild) {
    const cleanQuery = String(channelName).replace(/^#/, "").toLowerCase().trim();
    const aliasMap = {
      "uniforme": "1564772258646589641",
      "anuncios-internos": "1563511678254190602",
      "anuncios": "1347866807205367879",
      "reuniones": "1563511968541970513",
      "bonos": "1564772178371547216",
      "actualizaciones": "1564772322118869002",
      "general": "1563504973008863292",
      "chat-empleados": "1564772614692405278"
    };
    const mappedId = aliasMap[cleanQuery];
    if (mappedId) {
      channel = await client.channels.fetch(mappedId).catch(() => null);
    }
    if (!channel) {
      channel = guild.channels.cache.find(
        c => c.type === ChannelType.GuildText && c.name.toLowerCase().includes(cleanQuery)
      );
    }
  }

  if (!channel) {
    const fallbackId = db.config.anunciosChannelId || "1563511678254190602";
    channel = await client.channels.fetch(fallbackId).catch(() => null);
  }

  if (!channel) {
    throw new Error("No se encontró el canal de destino en Discord.");
  }

  let contentMention = undefined;
  if (mention && mention !== "Sin mención") {
    if (mention === "@everyone" || mention === "@here") {
      contentMention = mention;
    } else if (mention === "@Empleados") {
      const empRoleId = db.config.empleadosRoleId || "1564762865246675074";
      contentMention = `<@&${empRoleId}>`;
    } else if (/^\d+$/.test(String(mention))) {
      contentMention = `<@&${mention}>`;
    } else {
      contentMention = mention;
    }
  }

  const logoPath = path.join(__dirname, "..", "public", "assets", "logo.jpg");
  const files = [];
  const embed = new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle(`🛡️ ${title || "COMUNICADO OFICIAL | IMPERION SECURITY"}`)
    .setDescription(message || "")
    .setFooter({ text: "IMPERION Security • Protegiendo lo que importa" })
    .setTimestamp();

  if (fs.existsSync(logoPath)) {
    files.push(new AttachmentBuilder(logoPath, { name: "logo.jpg" }));
    embed.setThumbnail("attachment://logo.jpg");
  }

  if (imageUrl && imageUrl.startsWith("http")) {
    embed.setImage(imageUrl);
  }

  await channel.send({
    content: contentMention,
    embeds: [embed],
    files
  });

  return { ok: true, channelName: channel.name, channelId: channel.id };
}

async function sendMeetingToDiscord({ channelId, fechaHora, tema }) {
  if (!isBotConnected) throw new Error("El bot no está conectado.");
  const db = readDb();
  const targetId = channelId || db.config.reunionesChannelId || "1563511968541970513";
  const channel = await client.channels.fetch(targetId).catch(() => null);
  if (!channel) throw new Error("No se encontró el canal #reuniones.");

  db.employees.forEach(e => {
    e.attendance = "Pendiente";
    e.reason = "";
  });
  addFeedEvent(db, "REUNIÓN", `Convocatoria publicada en #${channel.name}: ${fechaHora}`);
  writeDb(db);

  const empRoleId = db.config.empleadosRoleId || "1564762865246675074";
  await channel.send({
    content: `<@&${empRoleId}>`,
    embeds: [buildMeetingEmbed(fechaHora, tema, db)],
    components: [buildMeetingButtons()]
  });
  return true;
}

async function sendClockPanelToDiscord(targetChannel = null, customChannelId = null) {
  const db = readDb();
  const channelId = customChannelId || db.config.clockChannelId || process.env.CHANNEL_CLOCK_ID || "1564772465819787314";
  let channel = targetChannel;
  if (!channel && isBotConnected && channelId) {
    channel = await client.channels.fetch(channelId).catch(() => null);
  }
  if (!channel) return false;

  const embed = new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle("⏱️ CONTROL DE HORARIO Y SERVICIO | IMPERION SECURITY")
    .setDescription(
      "Utilizá los botones inferiores para registrar tu **Entrada** y **Salida** de servicio en el servidor.\n\n" +
      "• **Entrada:** Inicia tu cómputo de horas y te asigna el rol `En servicio`.\n" +
      "• **Salida:** Cierra tu turno y acredita el tiempo trabajado en tu legajo semanal.\n" +
      "• **Control Anti-AFK:** Los turnos que superen las **5 horas continuas** recibirán una verificación por MD."
    )
    .setFooter({ text: "IMPERION Security • Sistema Automatizado de Fichaje" });

  await channel.send({
    embeds: [embed],
    components: buildClockComponents()
  });
  return true;
}

async function sendTicketsPanelToDiscord(targetChannel = null, customChannelId = null) {
  const db = readDb();
  const channelId = customChannelId || db.config.soporteChannelId || "1347868773914247179";
  let channel = targetChannel;
  if (!channel && isBotConnected && channelId) {
    channel = await client.channels.fetch(channelId).catch(() => null);
  }
  if (!channel) return false;

  const logoPath = path.join(__dirname, "..", "public", "assets", "logo.jpg");
  const files = [];
  const embed = new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle("🛡️ CENTRO DE ATENCIÓN Y POSTULACIONES | IMPERION SECURITY")
    .setDescription(
      "Seleccioná la categoría correspondiente para abrir un canal privado con **IMPERION Security**:\n\n" +
      "• **Postularse a IMPERION:** Ingreso a la compañía (Evaluado por **RRHH, Instructores y Dirección**).\n" +
      "• **Contratar Seguridad:** Servicios de escolta, seguridad de eventos, alarmas y cámaras.\n" +
      "• **Hablar con Dirección:** Consultas administrativas o soporte interno."
    )
    .setFooter({ text: "IMPERION Security • Protegiendo lo que importa" });

  if (fs.existsSync(logoPath)) {
    files.push(new AttachmentBuilder(logoPath, { name: "logo.jpg" }));
    embed.setThumbnail("attachment://logo.jpg");
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_postulacion")
      .setLabel("Postularse a IMPERION")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ticket_servicio")
      .setLabel("Contratar Seguridad")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("ticket_soporte")
      .setLabel("Hablar con Dirección")
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ embeds: [embed], files, components: [row] });
  return true;
}

async function sendLiquidacionToDiscord(summaryList, totalAmount) {
  if (!isBotConnected) return false;
  const db = readDb();
  const channelId = db.config.bonosChannelId || process.env.CHANNEL_BONOS_ID || "1564772178371547216";
  if (!channelId) return false;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;

  const lines = summaryList
    .map(item => `• **${item.name}** (${item.rank}) — **$${item.bonus.toLocaleString("es-AR")}** (${item.hours.toFixed(1)}h)`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle("💵 LIQUIDACIÓN SEMANAL DE BONOS | IMPERION SECURITY")
    .setDescription(lines || "Sin montos pendientes.")
    .addFields({
      name: "Total Liquidado por Dirección",
      value: `**$${totalAmount.toLocaleString("es-AR")}**`
    })
    .setFooter({ text: "IMPERION Security • Contabilidad Automatizada" })
    .setTimestamp();

  const empRoleId = db.config.empleadosRoleId || "1564762865246675074";
  await channel.send({
    content: `<@&${empRoleId}>`,
    embeds: [embed]
  });
  return true;
}

// ============================================================================
// MANEJO DE INTERACCIONES (COMANDOS, BOTONES, SELECTORES Y MODALES)
// ============================================================================
client.on("interactionCreate", async interaction => {
  try {
    const db = readDb();

    // ---------------- SLASH COMMANDS ----------------
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === "clock") {
        await interaction.reply({
          components: buildClockComponents()
        });
        return;
      }

      if (commandName === "mi-acceso") {
        const member = interaction.member;
        if (!canMemberReviewApplications(member)) {
          return interaction.reply({
            content: "🚫 **Acceso restringido:** Solo los miembros de **Dirección (Rangos Altos)**, **Recursos Humanos (RRHH)** e **Instructores / Evaluadores** pueden obtener credenciales para el Panel Web.",
            ephemeral: true
          });
        }

        const nombreIc = interaction.options.getString("nombre_ic").trim();
        let accessLevel = "Instructor";
        let roleTitle = "📘 Instructor / Evaluador";

        const highestRole = member.roles.cache
          .filter(r => r.name !== "@everyone" && r.name !== "." && !r.managed)
          .sort((a, b) => b.position - a.position)
          .first();

        if (highestRole) {
          roleTitle = highestRole.name;
          const low = highestRole.name.toLowerCase();
          if (
            member.permissions?.has(PermissionFlagsBits.Administrator) ||
            low.includes("ceo") ||
            low.includes("fundador") ||
            low.includes("director") ||
            low.includes("socio") ||
            low.includes("jefe") ||
            low.includes("supervisor") ||
            low.includes("lider")
          ) {
            accessLevel = "Direccion";
          } else if (low.includes("rrhh") || low.includes("recursos humanos")) {
            accessLevel = "RRHH";
          }
        }

        let staffEntry = db.staffUsers.find(u => u.discordId === interaction.user.id);
        if (!staffEntry) {
          const randomPin = `IMP-${Math.floor(1000 + Math.random() * 9000)}`;
          staffEntry = {
            id: String(Date.now()),
            discordId: interaction.user.id,
            discordTag: `@${interaction.user.username}`,
            icName: nombreIc,
            roleTitle,
            accessLevel,
            securityCode: randomPin,
            createdAt: new Date().toLocaleDateString("es-AR")
          };
          db.staffUsers.push(staffEntry);
        } else {
          staffEntry.icName = nombreIc;
          staffEntry.roleTitle = roleTitle;
          staffEntry.accessLevel = accessLevel;
        }

        addFeedEvent(db, "ACCESO", `Credencial Web activa para ${nombreIc} (${roleTitle})`);
        writeDb(db);

        return interaction.reply({
          content:
            `🔐 **Credencial de Acceso al Panel Web | IMPERION Security**\n\n` +
            `• **Nombre dentro del juego (IC):** \`${staffEntry.icName}\`\n` +
            `• **Código de Seguridad:** \`${staffEntry.securityCode}\`\n` +
            `• **Rol reconocido:** **${staffEntry.roleTitle}**\n\n` +
            `*Ingresá esos dos datos en la pantalla de Login del Panel Web para aprobar o rechazar solicitudes.*`,
          ephemeral: true
        });
      }

      if (commandName === "actividad") {
        const val = interaction.options.getString("tipo");
        const [key, title] = val.split("|");
        await sendActivityToDiscord(title, key, interaction.channel);
        addFeedEvent(db, "OPERATIVO", `${interaction.user.username} lanzó actividad: ${title}`);
        writeDb(db);
        await interaction.reply({ content: `✅ Actividad **${title}** publicada correctamente.`, ephemeral: true });
        return;
      }

      if (commandName === "reunion") {
        const fechaHora = interaction.options.getString("fecha_hora");
        const tema = interaction.options.getString("tema");
        db.employees.forEach(e => {
          e.attendance = "Pendiente";
          e.reason = "";
        });
        addFeedEvent(db, "REUNIÓN", `Nueva reunión convocada para ${fechaHora}`);
        writeDb(db);

        const empRoleId = db.config.empleadosRoleId || "1564762865246675074";
        await interaction.reply({
          content: `<@&${empRoleId}>`,
          embeds: [buildMeetingEmbed(fechaHora, tema, db)],
          components: [buildMeetingButtons()]
        });
        return;
      }

      if (commandName === "bono") {
        const targetUser = interaction.options.getUser("empleado");
        const monto = interaction.options.getInteger("monto");
        const motivo = interaction.options.getString("motivo");

        const emp = findOrCreateEmployee(db, targetUser.id, targetUser.username, targetUser.globalName);
        emp.bonusExtra = (emp.bonusExtra || 0) + monto;
        addFeedEvent(db, "BONO", `Bono de $${monto.toLocaleString("es-AR")} otorgado a ${emp.name} (${motivo})`);
        writeDb(db);

        const embed = new EmbedBuilder()
          .setColor(0xd4af37)
          .setTitle("💰 BONO OTORGADO | IMPERION SECURITY")
          .addFields(
            { name: "Agente Beneficiario", value: `<@${targetUser.id}> (${emp.name})`, inline: true },
            { name: "Monto Acreditado", value: `**$${monto.toLocaleString("es-AR")}**`, inline: true },
            { name: "Motivo", value: motivo, inline: false }
          )
          .setFooter({ text: `Otorgado por ${interaction.user.username}` })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (commandName === "contratar") {
        if (!canMemberReviewApplications(interaction.member)) {
          return interaction.reply({
            content: "🚫 Solo **Rangos Altos**, **RRHH** e **Instructores** pueden usar `/contratar`.",
            ephemeral: true
          });
        }
        const user = interaction.options.getUser("usuario");
        if (user.bot) {
          return interaction.reply({ content: "⚠️ No podés contratar a un bot.", ephemeral: true });
        }
        const nombreIc = interaction.options.getString("nombre_ic");
        const selectedRole = interaction.options.getRole("rol");

        const emp = findOrCreateEmployee(db, user.id, user.username, nombreIc);
        emp.name = nombreIc;
        emp.rank = selectedRole.name;
        emp.roleId = selectedRole.id;
        addFeedEvent(db, "ALTA", `${nombreIc} fue contratado con rol ${selectedRole.name}`);
        writeDb(db);
        updateBotPresence();

        const member = await interaction.guild?.members.fetch(user.id).catch(() => null);
        if (member) {
          await syncMemberRankRole(user.id, selectedRole.id, true).catch(() => null);
          await member.setNickname(`${nombreIc}`).catch(() => null);
        }

        await interaction.reply({
          content: `✅ **${nombreIc}** (<@${user.id}>) fue dado de alta en **IMPERION Security** con el rol <@&${selectedRole.id}> + <@&${db.config.empleadosRoleId || "1564762865246675074"}>.`
        });
        return;
      }

      if (commandName === "ascender") {
        if (!canMemberReviewApplications(interaction.member)) {
          return interaction.reply({
            content: "🚫 Solo **Rangos Altos** y **RRHH** pueden modificar rangos.",
            ephemeral: true
          });
        }
        const user = interaction.options.getUser("empleado");
        if (user.bot) {
          return interaction.reply({ content: "⚠️ No podés modificar el rango de un bot.", ephemeral: true });
        }
        const nuevoRol = interaction.options.getRole("nuevo_rol");
        const emp = findOrCreateEmployee(db, user.id, user.username, user.globalName);
        emp.rank = nuevoRol.name;
        emp.roleId = nuevoRol.id;
        addFeedEvent(db, "RANGO", `${emp.name} fue promovido a ${nuevoRol.name}`);
        writeDb(db);

        await syncMemberRankRole(user.id, nuevoRol.id, true).catch(() => null);

        await interaction.reply({
          content: `🎖️ El agente **${emp.name}** (<@${user.id}>) ahora posee el rol jerárquico <@&${nuevoRol.id}>.`
        });
        return;
      }

      if (commandName === "sancionar") {
        if (!canMemberReviewApplications(interaction.member)) {
          return interaction.reply({
            content: "🚫 Solo **Rangos Altos**, **RRHH** e **Instructores** pueden aplicar sanciones.",
            ephemeral: true
          });
        }
        const user = interaction.options.getUser("empleado");
        const motivo = interaction.options.getString("motivo");
        const emp = findOrCreateEmployee(db, user.id, user.username, user.globalName);
        emp.warnings = (emp.warnings || 0) + 1;
        addFeedEvent(db, "SANCIÓN", `${emp.name} recibió sanción (${emp.warnings}/3): ${motivo}`);
        writeDb(db);

        await interaction.reply({
          content: `⚠️ Sanción registrada a **${emp.name}** (<@${user.id}>) — Acumuladas: **${emp.warnings}/3**.\n**Motivo:** ${motivo}`
        });
        return;
      }

      if (commandName === "despedir") {
        if (!canMemberReviewApplications(interaction.member)) {
          return interaction.reply({
            content: "🚫 Solo **Rangos Altos** y **RRHH** pueden dar de baja personal.",
            ephemeral: true
          });
        }
        const user = interaction.options.getUser("empleado");
        const motivo = interaction.options.getString("motivo");
        db.employees = db.employees.filter(e => e.discordId !== user.id);
        addFeedEvent(db, "BAJA", `${user.username} fue dado de baja (${motivo})`);
        writeDb(db);
        updateBotPresence();

        const member = await interaction.guild?.members.fetch(user.id).catch(() => null);
        if (member) {
          const allCompanyRoles = [
            ...COMPANY_RANK_ROLES.map(r => r.id),
            db.config.rrhhRoleId,
            db.config.empleadosRoleId || "1564762865246675074",
            db.config.enServicioRoleId || "1564763063197110372"
          ];
          for (const rId of allCompanyRoles) {
            if (rId && member.roles.cache.has(rId)) {
              await member.roles.remove(rId).catch(() => null);
            }
          }
        }

        await interaction.reply({
          content: `🚫 <@${user.id}> fue dado de baja de **IMPERION Security** y se retiraron sus roles. Motivo: *${motivo}*`
        });
        return;
      }

      if (commandName === "legajo") {
        const target = interaction.options.getUser("empleado") || interaction.user;
        const emp = findOrCreateEmployee(db, target.id, target.username, target.globalName);
        const totalBonus = calculateEmployeeBonus(emp, db.rates);

        const embed = new EmbedBuilder()
          .setColor(0xd4af37)
          .setTitle(`📋 LEGAJO OFICIAL — ${emp.name}`)
          .addFields(
            { name: "Rango Actual", value: emp.rank, inline: true },
            { name: "Estado", value: emp.onDuty ? "🟢 En Servicio" : "⚪ Fuera de Servicio", inline: true },
            { name: "Sanciones", value: `${emp.warnings || 0} / 3`, inline: true },
            { name: "Horas Semanales", value: `${emp.hours.toFixed(1)}h`, inline: true },
            { name: "Horas Históricas", value: `${(emp.totalHours || emp.hours).toFixed(1)}h`, inline: true },
            { name: "Bono Acumulado", value: `$${totalBonus.toLocaleString("es-AR")}`, inline: true },
            {
              name: "Actividades Completadas (Semana)",
              value: `Cajeros: **${emp.atm}** | Alarmas: **${emp.alarm || 0}** | Cámaras: **${emp.cam}** | Escoltas: **${emp.escort}** | Revisión: **${emp.rev || 0}**`,
              inline: false
            }
          )
          .setFooter({ text: "IMPERION Security • Sistema de Gestión" });

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (commandName === "comunicado") {
        const titulo = interaction.options.getString("titulo");
        const mensaje = interaction.options.getString("mensaje");
        const imagenUrl = interaction.options.getString("imagen_url");

        const embed = new EmbedBuilder()
          .setColor(0xd4af37)
          .setTitle(`🛡️ ${titulo}`)
          .setDescription(mensaje)
          .setFooter({ text: "IMPERION Security • Protegiendo lo que importa" })
          .setTimestamp();

        if (imagenUrl) embed.setImage(imagenUrl);

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (commandName === "panel-tickets") {
        await sendTicketsPanelToDiscord(interaction.channel);
        await interaction.reply({ content: "✅ Panel de Tickets desplegado.", ephemeral: true });
        return;
      }

      if (commandName === "crear-contadores") {
        await interaction.deferReply({ ephemeral: true });
        await ensureRRHHRole(interaction.guild);
        await createServerCounterChannels(interaction.guild);
        await ensureApplicationLogChannels(interaction.guild);
        await interaction.editReply(
          "✅ Rol `💼・Recursos Humanos (RRHH)`, canales contadores (`👮 Empleados` y `🟢 En Servicio`) y canales de logs de postulaciones verificados y sincronizados."
        );
        return;
      }

      if (commandName === "configurar-canales") {
        const autoRol = interaction.options.getRole("autorol_aprobacion");
        const rolEmp = interaction.options.getRole("rol_empleados");
        const cLogAp = interaction.options.getChannel("log_aprobadas");
        const cLogRe = interaction.options.getChannel("log_rechazadas");
        const cClock = interaction.options.getChannel("canal_clock");
        const cAct = interaction.options.getChannel("canal_actividades");
        const cBonos = interaction.options.getChannel("canal_bonos");

        if (autoRol) db.config.autoRoleApproveId = autoRol.id;
        if (rolEmp) db.config.empleadosRoleId = rolEmp.id;
        if (cLogAp) db.config.logAprobadasChannelId = cLogAp.id;
        if (cLogRe) db.config.logRechazadasChannelId = cLogRe.id;
        if (cClock) db.config.clockChannelId = cClock.id;
        if (cAct) db.config.actividadesChannelId = cAct.id;
        if (cBonos) db.config.bonosChannelId = cBonos.id;
        writeDb(db);

        await interaction.reply({
          content: "✅ Configuración de autorol, canales y logs guardada correctamente.",
          ephemeral: true
        });
        return;
      }
    }

    // ---------------- SELECT MENUS (ELEGIR ROL EN TICKET) ----------------
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("select_approve_role_")) {
        if (!canMemberReviewApplications(interaction.member)) {
          return interaction.reply({
            content: "🚫 **Acceso denegado:** Solo **Rangos Altos**, **RRHH** e **Instructores** pueden seleccionar el rol de aprobación.",
            ephemeral: true
          });
        }
        const applicantId = interaction.customId.replace("select_approve_role_", "");
        const chosenRoleId = interaction.values[0];
        ticketSelectedRoleMap.set(applicantId, chosenRoleId);
        const roleObj = interaction.guild?.roles.cache.get(chosenRoleId);
        await interaction.reply({
          content: `🎖️ Rol seleccionado para asignar al aprobar a <@${applicantId}>: **${roleObj ? roleObj.name : chosenRoleId}**. Ahora tocá el botón verde **✅ Aprobar**.`,
          ephemeral: true
        });
        return;
      }
    }

    // ---------------- BOTONES INTERACTIVOS ----------------
    if (interaction.isButton()) {
      const { customId } = interaction;
      const emp = findOrCreateEmployee(
        db,
        interaction.user.id,
        interaction.user.username,
        interaction.member?.displayName || interaction.user.globalName
      );

      // 1. BOTONES DEL PANEL /CLOCK
      if (customId === "keep_duty_alive") {
        if (!emp.onDuty) {
          return interaction.reply({ content: "⚠️ Tu turno ya estaba cerrado.", ephemeral: true });
        }
        const elapsedMs = Date.now() - (emp.dutyStart || Date.now());
        const elapsedHours = Math.max(0.05, elapsedMs / (1000 * 60 * 60));
        emp.hours = Number((emp.hours + elapsedHours).toFixed(2));
        emp.totalHours = Number(((emp.totalHours || 0) + elapsedHours).toFixed(2));
        emp.dutyStart = Date.now();
        emp.warnedAFK = false;
        addFeedEvent(db, "CLOCK", `${emp.name} confirmó actividad y renovó su turno activo`);
        writeDb(db);
        return interaction.reply({
          content: `🟢 **Turno renovado.** Se acreditaron tus horas previas (**${emp.hours.toFixed(1)}h** acumuladas) y tu reloj sigue corriendo por otro bloque de hasta 5 horas.`,
          ephemeral: true
        });
      }

      if (customId === "clock_in") {
        if (emp.onDuty) {
          return interaction.reply({ content: "⚠️ Ya te encontrás **En Servicio** actualmente.", ephemeral: true });
        }
        emp.onDuty = true;
        emp.dutyStart = Date.now();
        addFeedEvent(db, "CLOCK", `${emp.name} fichó Entrada en #clock`);
        writeDb(db);
        updateBotPresence();
        syncMemberDutyRole(interaction.user.id, true).catch(() => null);
        return interaction.reply({
          content: `🟢 **Entrada registrada** para **${emp.name}**. Se te asignó el rol **En servicio** y tu tiempo está corriendo.`,
          ephemeral: true
        });
      }

      if (customId === "clock_out") {
        if (!emp.onDuty) {
          return interaction.reply({ content: "⚠️ No tenés ningún turno abierto en este momento.", ephemeral: true });
        }
        const elapsedMs = Date.now() - (emp.dutyStart || Date.now());
        const elapsedHours = Math.max(0.05, elapsedMs / (1000 * 60 * 60));
        emp.onDuty = false;
        emp.dutyStart = null;
        emp.hours = Number((emp.hours + elapsedHours).toFixed(2));
        emp.totalHours = Number(((emp.totalHours || 0) + elapsedHours).toFixed(2));

        const mins = Math.max(1, Math.round(elapsedMs / 60000));
        addFeedEvent(db, "CLOCK", `${emp.name} fichó Salida (+${mins} min)`);
        writeDb(db);
        updateBotPresence();
        syncMemberDutyRole(interaction.user.id, false).catch(() => null);

        return interaction.reply({
          content: `🔴 **Salida registrada.** Sumaste **${mins} minutos** en este turno.\n⏱️ Total acumulado en la semana: **${emp.hours.toFixed(1)}h**.`,
          ephemeral: true
        });
      }

      if (customId === "clock_active") {
        const active = db.employees.filter(e => e.onDuty);
        const list = active.length
          ? active
              .map(e => {
                const mins = e.dutyStart ? Math.max(1, Math.round((Date.now() - e.dutyStart) / 60000)) : 15;
                return `🟢 **${e.name}** (${e.rank}) — *en servicio hace ${mins} min*`;
              })
              .join("\n")
          : "*No hay agentes en servicio en este momento.*";

        return interaction.reply({
          content: `**👮 Agentes Trabajando Actualmente (${active.length}):**\n${list}`,
          ephemeral: true
        });
      }

      if (customId === "clock_total") {
        return interaction.reply({
          content: `⏱️ **Mi Tiempo Total (${emp.name}):**\n• Horas esta semana: **${emp.hours.toFixed(1)}h**\n• Horas históricas: **${(emp.totalHours || emp.hours).toFixed(1)}h**`,
          ephemeral: true
        });
      }

      if (customId === "clock_stats") {
        const bonus = calculateEmployeeBonus(emp, db.rates);
        return interaction.reply({
          content:
            `📊 **Estadísticas de ${emp.name} (${emp.rank}):**\n` +
            `• Horas semanales: **${emp.hours.toFixed(1)}h / 12.0h**\n` +
            `• Cajeros: **${emp.atm}** | Alarmas: **${emp.alarm || 0}** | Cámaras: **${emp.cam}** | Escoltas: **${emp.escort}** | Revisión: **${emp.rev || 0}**\n` +
            `• Liquidación estimada en bonos: **$${bonus.toLocaleString("es-AR")}**`,
          ephemeral: true
        });
      }

      if (customId === "clock_admin") {
        const top = [...db.employees]
          .sort((a, b) => b.hours - a.hours)
          .map((e, idx) => `${idx + 1}. **${e.name}** — ${e.hours.toFixed(1)}h ($${calculateEmployeeBonus(e, db.rates).toLocaleString("es-AR")})`)
          .join("\n");

        return interaction.reply({
          content: `⚙️ **Panel de Administración — Resumen de Horas y Bonos:**\n${top || "Sin registros aún."}`,
          ephemeral: true
        });
      }

      // 2. CERTIFICAR ACTIVIDAD REALIZADA
      if (customId.startsWith("claim_activity_")) {
        const parts = customId.replace("claim_activity_", "").split("_");
        const key = parts[0];
        const title = parts.slice(1).join("_");

        emp[key] = (emp[key] || 0) + 1;
        const rewardVal = db.rates[key] || 3500;

        db.activitiesLog.unshift({
          id: Date.now(),
          emp: emp.name,
          type: title,
          time: "Recién certificado",
          reward: `$${rewardVal.toLocaleString("es-AR")}`,
          status: "Certificado"
        });
        addFeedEvent(db, "BONO", `${emp.name} certificó ${title} (+$${rewardVal.toLocaleString("es-AR")})`);
        writeDb(db);

        return interaction.reply({
          content: `✅ **${emp.name}** certificó la actividad **${title}** (+**$${rewardVal.toLocaleString("es-AR")}** sumados a tu bono semanal).`
        });
      }

      // 3. BOTONES DE ASISTENCIA A REUNIÓN
      if (customId === "meeting_confirm") {
        emp.attendance = "Confirmado";
        emp.reason = "";
        addFeedEvent(db, "REUNIÓN", `${emp.name} confirmó asistencia a la reunión`);
        writeDb(db);

        const oldEmbed = interaction.message.embeds[0];
        const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(
          {
            name: `✅ Asistirán (${db.employees.filter(e => e.attendance === "Confirmado").length})`,
            value:
              db.employees
                .filter(e => e.attendance === "Confirmado")
                .map(e => `• **${e.name}** (${e.rank})`)
                .join("\n") || "*Sin confirmaciones aún*"
          },
          {
            name: `❌ No pueden asistir (${db.employees.filter(e => e.attendance === "Ausente").length})`,
            value:
              db.employees
                .filter(e => e.attendance === "Ausente")
                .map(e => `• **${e.name}** — *Motivo: ${e.reason || "Sin especificar"}*`)
                .join("\n") || "*Sin ausencias registradas*"
          }
        );

        await interaction.update({ embeds: [updatedEmbed] });
        return;
      }

      if (customId === "meeting_absent") {
        const modal = new ModalBuilder()
          .setCustomId("modal_meeting_absent")
          .setTitle("Justificar Inasistencia a Reunión");

        const reasonInput = new TextInputBuilder()
          .setCustomId("absent_reason")
          .setLabel("Motivo por el cual no podés asistir")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Ej: Estoy trabajando OOC hasta las 23hs")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
        return;
      }

      // 4. BOTONES DE TICKETS (CON PERMISOS AUTOMÁTICOS PARA RANGOS ALTOS, RRHH E INSTRUCTORES)
      if (["ticket_postulacion", "ticket_servicio", "ticket_soporte"].includes(customId)) {
        const tipoMap = {
          ticket_postulacion: "postulacion",
          ticket_servicio: "contratacion",
          ticket_soporte: "soporte"
        };
        const label = tipoMap[customId];
        const channelName = `${label}-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

        const overwrites = [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles
            ]
          }
        ];

        // Dar acceso automático en el ticket a Rangos Altos, RRHH e Instructores
        for (const rId of AUTHORIZED_REVIEWER_ROLE_IDS) {
          if (interaction.guild.roles.cache.has(rId)) {
            overwrites.push({
              id: rId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
              ]
            });
          }
        }
        if (db.config.rrhhRoleId && interaction.guild.roles.cache.has(db.config.rrhhRoleId)) {
          overwrites.push({
            id: db.config.rrhhRoleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles
            ]
          });
        }

        const ticketChannel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: db.config.ticketsCategoryId || process.env.CATEGORY_TICKETS_ID || "1563499611665072240",
          permissionOverwrites: overwrites
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("ticket_close")
            .setLabel("Cerrar y Archivar Ticket")
            .setStyle(ButtonStyle.Danger)
        );

        if (customId === "ticket_postulacion") {
          const postulacionEmbed = new EmbedBuilder()
            .setColor(0xd4af37)
            .setTitle("🛡️ FORMULARIO DE POSTULACIÓN | IMPERION SECURITY")
            .setDescription(
              `Bienvenido/a <@${interaction.user.id}> al canal de postulaciones de **IMPERION Security**.\n\n` +
              `**PASO 1:** Subí en este canal las **2 capturas de pantalla completas (SIN RECORTES)**:\n` +
              `• Tu conducta del servidor (*Tab - Perfil - Opciones - Mi Conducta*)\n` +
              `• Tus reportes abiertos (*F9 - Reportes - Abiertos*)\n\n` +
              `**PASO 2:** Tocá el botón **📝 Enviar Solicitud a Dirección** (o copiá y respondé esta plantilla en el chat):\n` +
              `\`\`\`\n` +
              `Nombre y Apellido | HASH:\n` +
              `Residencia:\n` +
              `Célular:\n` +
              `¿Tiene experiencia?:\n` +
              `¿Tiene antecedentes?:\n` +
              `¿Tienes experiencia en seguridad u otro rubro (mecánica, transporte, limpieza)?:\n` +
              `Nivel:\n` +
              `Disponibilidad horaria ((en hora hub)):\n` +
              `País:\n` +
              `¿Tenés sanciones/advertencias? Adjunta tu conducta del servidor (Tab - Perfil - Opciones Mi Conducta ) - ENVIA FOTO SIN RECORTES\n` +
              `¿Contas con reportes abiertos? Adjunta una imagen de tus reportes ( F9 - REPORTES - ABIERTOS) ENVIA FOTO SIN RECORTES\n` +
              `\`\`\``
            )
            .setFooter({ text: "IMPERION Security • Evaluado por Dirección, RRHH e Instructores" })
            .setTimestamp();

          const defaultRoleId = db.config.autoRoleApproveId || "1563510109513195550";
          const roleSelectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`select_approve_role_${interaction.user.id}`)
              .setPlaceholder("🎖️ [Staff/RRHH/Instructor] Elegir Rol a dar al aprobar...")
              .addOptions(
                COMPANY_RANK_ROLES.slice(0, 25).map(r => ({
                  label: r.name,
                  value: r.id,
                  default: r.id === defaultRoleId
                }))
              )
          );

          const postulacionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`open_apply_form_${interaction.user.id}`)
              .setLabel("📝 Enviar Solicitud a Dirección")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`ticket_approve_${interaction.user.id}`)
              .setLabel("✅ Aprobar")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`ticket_reject_${interaction.user.id}`)
              .setLabel("❌ Rechazar")
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId("ticket_close")
              .setLabel("Cerrar Ticket")
              .setStyle(ButtonStyle.Danger)
          );

          const rrhhPing = db.config.rrhhRoleId ? `<@&${db.config.rrhhRoleId}>` : "";
          const instructorPing = `<@&1563509865350168598>`;

          await ticketChannel.send({
            content: `<@${interaction.user.id}> | Atención: ${rrhhPing} ${instructorPing}`,
            embeds: [postulacionEmbed],
            components: [roleSelectRow, postulacionRow]
          });
        } else if (customId === "ticket_servicio") {
          const servicioEmbed = new EmbedBuilder()
            .setColor(0xd4af37)
            .setTitle("🛡️ CONTRATACIÓN DE SERVICIOS | IMPERION SECURITY")
            .setDescription(
              `Bienvenido/a <@${interaction.user.id}> al Departamento Comercial de **IMPERION Security**.\n\n` +
              `Por favor, indicanos los siguientes datos para cotizar tu servicio:\n` +
              `\`\`\`\n` +
              `Nombre y Apellido / Empresa:\n` +
              `Teléfono de contacto IC:\n` +
              `Servicio requerido (Escolta / Seguridad de Evento / Cámaras y Alarmas):\n` +
              `Fecha, Horario y Ubicación:\n` +
              `Detalles adicionales:\n` +
              `\`\`\``
            )
            .setFooter({ text: "IMPERION Security • División Comercial" })
            .setTimestamp();

          await ticketChannel.send({
            content: `<@${interaction.user.id}>`,
            embeds: [servicioEmbed],
            components: [closeRow]
          });
        } else {
          await ticketChannel.send({
            content: `Bienvenido <@${interaction.user.id}>. Un miembro de la Dirección de **IMPERION Security** te atenderá en breve.`,
            components: [closeRow]
          });
        }

        addFeedEvent(db, "TICKET", `Ticket #${channelName} abierto por ${interaction.user.username}`);
        writeDb(db);

        return interaction.reply({
          content: `✅ Tu canal de atención fue creado: <#${ticketChannel.id}>`,
          ephemeral: true
        });
      }

      if (customId.startsWith("open_apply_form_")) {
        const modal = new ModalBuilder()
          .setCustomId("modal_submit_application")
          .setTitle("Formulario Oficial — IMPERION Security");

        const f1 = new TextInputBuilder()
          .setCustomId("app_nombre_hash")
          .setLabel("Nombre y Apellido | HASH")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Ej: Marcos Santana | #A1B2C")
          .setRequired(true);

        const f2 = new TextInputBuilder()
          .setCustomId("app_datos_personales")
          .setLabel("Residencia | Celular | Nivel | País")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Ej: Vinewood | 555-1234 | Nivel 15 | Argentina")
          .setRequired(true);

        const f3 = new TextInputBuilder()
          .setCustomId("app_experiencia")
          .setLabel("¿Experiencia en seguridad u otros rubros?")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Detallá experiencia previa y si tenés antecedentes IC...")
          .setRequired(true);

        const f4 = new TextInputBuilder()
          .setCustomId("app_disponibilidad")
          .setLabel("Disponibilidad horaria ((en hora hub))")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Ej: 18:00 a 01:00 hora hub")
          .setRequired(true);

        const f5 = new TextInputBuilder()
          .setCustomId("app_sanciones_reportes")
          .setLabel("¿Tenés sanciones o reportes abiertos?")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Sí / No (Recordá subir las 2 fotos sin recortar en el ticket)")
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(f1),
          new ActionRowBuilder().addComponents(f2),
          new ActionRowBuilder().addComponents(f3),
          new ActionRowBuilder().addComponents(f4),
          new ActionRowBuilder().addComponents(f5)
        );

        await interaction.showModal(modal);
        return;
      }

      if (customId.startsWith("ticket_approve_")) {
        if (!canMemberReviewApplications(interaction.member)) {
          return interaction.reply({
            content: "🚫 **Acceso denegado:** Solo **Rangos Altos**, **RRHH** e **Instructores** tienen permiso para aprobar postulaciones.",
            ephemeral: true
          });
        }

        const applicantId = customId.replace("ticket_approve_", "");
        const modal = new ModalBuilder()
          .setCustomId(`modal_approve_${applicantId}`)
          .setTitle("Aprobar y Dar Autorol al Postulante");

        const existingApp = db.applications.find(a => a.userId === applicantId && a.status === "Pendiente");
        const defaultName = existingApp ? existingApp.nombreHash.split("|")[0].trim() : "";

        const chosenRoleId = ticketSelectedRoleMap.get(applicantId) || db.config.autoRoleApproveId || "1563510109513195550";
        const roleObj = interaction.guild?.roles.cache.get(chosenRoleId);
        const defaultRoleName = roleObj ? roleObj.name : "🛡️・Agente de Seguridad";

        const nameInput = new TextInputBuilder()
          .setCustomId("approve_name_ic")
          .setLabel("Nombre y Apellido IC del nuevo agente")
          .setStyle(TextInputStyle.Short)
          .setValue(defaultName || "Nuevo Agente")
          .setPlaceholder("Ej: Marcos Santana")
          .setRequired(true);

        const rankInput = new TextInputBuilder()
          .setCustomId("approve_rank")
          .setLabel("Rol a otorgar (Nombre o ID del rol)")
          .setStyle(TextInputStyle.Short)
          .setValue(defaultRoleName)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(rankInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (customId.startsWith("ticket_reject_")) {
        if (!canMemberReviewApplications(interaction.member)) {
          return interaction.reply({
            content: "🚫 **Acceso denegado:** Solo **Rangos Altos**, **RRHH** e **Instructores** tienen permiso para rechazar postulaciones.",
            ephemeral: true
          });
        }

        const applicantId = customId.replace("ticket_reject_", "");
        const modal = new ModalBuilder()
          .setCustomId(`modal_reject_${applicantId}`)
          .setTitle("Rechazar Postulación (Con Motivo)");

        const reasonInput = new TextInputBuilder()
          .setCustomId("reject_reason")
          .setLabel("Motivo del rechazo (Se enviará por MD y Log)")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Ej: Faltaron adjuntar las capturas de conducta/reportes sin recortar.")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
        return;
      }

      if (customId === "ticket_close") {
        await interaction.reply("🔒 Cerrando este ticket en 3 segundos...");
        setTimeout(() => {
          interaction.channel?.delete().catch(() => null);
        }, 3000);
        return;
      }
    }

    // ---------------- MODAL SUBMIT ----------------
    if (interaction.isModalSubmit() && interaction.customId === "modal_submit_application") {
      const nombreHash = interaction.fields.getTextInputValue("app_nombre_hash");
      const datosPersonales = interaction.fields.getTextInputValue("app_datos_personales");
      const experiencia = interaction.fields.getTextInputValue("app_experiencia");
      const disponibilidad = interaction.fields.getTextInputValue("app_disponibilidad");
      const sancionesReportes = interaction.fields.getTextInputValue("app_sanciones_reportes");

      const imageUrls = [];
      if (interaction.channel) {
        const msgs = await interaction.channel.messages.fetch({ limit: 25 }).catch(() => null);
        if (msgs) {
          msgs.forEach(m => {
            m.attachments.forEach(att => {
              if (att.url) imageUrls.push(att.url);
            });
          });
        }
      }

      const appEntry = {
        id: String(Date.now()),
        userId: interaction.user.id,
        discordTag: `@${interaction.user.username}`,
        guildId: interaction.guild?.id || "1347278829785190420",
        ticketChannelId: interaction.channel?.id || "",
        nombreHash,
        datosPersonales,
        experiencia,
        disponibilidad,
        sancionesReportes,
        images: imageUrls,
        status: "Pendiente",
        createdAt: new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
      };

      db.applications = db.applications.filter(a => !(a.userId === interaction.user.id && a.status === "Pendiente"));
      db.applications.unshift(appEntry);
      addFeedEvent(db, "POSTULACIÓN", `Nueva solicitud recibida en Dashboard: ${nombreHash}`);
      writeDb(db);

      const summaryEmbed = new EmbedBuilder()
        .setColor(0xd4af37)
        .setTitle("📋 SOLICITUD ENVIADA A DIRECCIÓN, RRHH E INSTRUCTORES")
        .addFields(
          { name: "Nombre y Apellido | HASH", value: nombreHash, inline: false },
          { name: "Residencia | Celular | Nivel | País", value: datosPersonales, inline: false },
          { name: "Experiencia y Antecedentes", value: experiencia, inline: false },
          { name: "Disponibilidad Horaria", value: disponibilidad, inline: true },
          { name: "Sanciones / Reportes", value: sancionesReportes, inline: true },
          { name: "Capturas detectadas en el ticket", value: `${imageUrls.length} imagen(es) adjunta(s)`, inline: false }
        )
        .setFooter({ text: "Aguardá en este ticket. Cuando Dirección, RRHH o un Instructor evalúe tu solicitud recibirás un MD automático." })
        .setTimestamp();

      await interaction.reply({ embeds: [summaryEmbed] });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_approve_")) {
      if (!canMemberReviewApplications(interaction.member)) {
        return interaction.reply({ content: "🚫 No tenés permisos para aprobar postulaciones.", ephemeral: true });
      }
      const applicantId = interaction.customId.replace("modal_approve_", "");
      const nombreIc = interaction.fields.getTextInputValue("approve_name_ic");
      const rangoInput = interaction.fields.getTextInputValue("approve_rank");
      const preSelectedRoleId = ticketSelectedRoleMap.get(applicantId);
      const reviewerLabel = getReviewerDisplayTitle(interaction.member, interaction.user.username);

      await interaction.deferReply();
      await approveApplicationCore({
        guildId: interaction.guild?.id,
        channelId: interaction.channel?.id,
        userId: applicantId,
        nombreIc,
        roleId: preSelectedRoleId || rangoInput,
        rango: rangoInput,
        reviewerName: reviewerLabel
      });
      ticketSelectedRoleMap.delete(applicantId);
      await interaction.editReply(
        `✅ Postulación de <@${applicantId}> aprobada por **${reviewerLabel}**. Autorol asignado, log enviado a <#${db.config.logAprobadasChannelId}>, instructivo enviado al privado y cerrando ticket...`
      );
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_reject_")) {
      if (!canMemberReviewApplications(interaction.member)) {
        return interaction.reply({ content: "🚫 No tenés permisos para rechazar postulaciones.", ephemeral: true });
      }
      const applicantId = interaction.customId.replace("modal_reject_", "");
      const reason = interaction.fields.getTextInputValue("reject_reason");
      const reviewerLabel = getReviewerDisplayTitle(interaction.member, interaction.user.username);

      await interaction.deferReply();
      await rejectApplicationCore({
        guildId: interaction.guild?.id,
        channelId: interaction.channel?.id,
        userId: applicantId,
        reason,
        reviewerName: reviewerLabel
      });
      await interaction.editReply(
        `❌ Postulación de <@${applicantId}> rechazada por **${reviewerLabel}**. Log enviado a <#${db.config.logRechazadasChannelId}>, motivo enviado por MD y cerrando ticket...`
      );
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "modal_meeting_absent") {
      const reason = interaction.fields.getTextInputValue("absent_reason");
      const emp = findOrCreateEmployee(
        db,
        interaction.user.id,
        interaction.user.username,
        interaction.member?.displayName || interaction.user.globalName
      );
      emp.attendance = "Ausente";
      emp.reason = reason;
      addFeedEvent(db, "REUNIÓN", `${emp.name} justificó ausencia: "${reason}"`);
      writeDb(db);

      if (interaction.message) {
        const oldEmbed = interaction.message.embeds[0];
        if (oldEmbed) {
          const updatedEmbed = EmbedBuilder.from(oldEmbed).setFields(
            {
              name: `✅ Asistirán (${db.employees.filter(e => e.attendance === "Confirmado").length})`,
              value:
                db.employees
                  .filter(e => e.attendance === "Confirmado")
                  .map(e => `• **${e.name}** (${e.rank})`)
                  .join("\n") || "*Sin confirmaciones aún*"
            },
            {
              name: `❌ No pueden asistir (${db.employees.filter(e => e.attendance === "Ausente").length})`,
              value:
                db.employees
                  .filter(e => e.attendance === "Ausente")
                  .map(e => `• **${e.name}** — *Motivo: ${e.reason || "Sin especificar"}*`)
                  .join("\n") || "*Sin ausencias registradas*"
            }
          );
          await interaction.message.edit({ embeds: [updatedEmbed] }).catch(() => null);
        }
      }

      return interaction.reply({
        content: `📝 Tu inasistencia fue registrada con el motivo: *"${reason}"*`,
        ephemeral: true
      });
    }
  } catch (err) {
    console.error("Error procesando interacción de Discord:", err);
  }
});

// ============================================================================
// INICIALIZACIÓN DEL BOT
// ============================================================================
async function startDiscordBot() {
  const token = process.env.DISCORD_TOKEN;

  if (!token || token === "PEGAR_AQUI_EL_TOKEN_DEL_BOT") {
    console.log("⚠️ [Bot Discord] Modo Demo Activo: Pegá tu DISCORD_TOKEN en el archivo .env para conectar el bot a Discord.");
    return;
  }

  try {
    const rest = new REST({ version: "10" }).setToken(token);

    client.once("ready", async () => {
      isBotConnected = true;
      const appId = client.user.id;
      console.log(`🛡️ [Bot Discord] Conectado 24/7 como ${client.user.tag} (ID: ${appId})`);

      // 1. Crear y configurar el rol de RRHH si no existe y darle permisos
      await ensureRRHHRole().catch(err =>
        console.error("⚠️ Error verificando rol RRHH:", err.message)
      );

      // 2. Crear/verificar canales de logs de postulaciones aprobadas y rechazadas
      await ensureApplicationLogChannels().catch(err =>
        console.error("⚠️ Error verificando canales de logs:", err.message)
      );

      // 3. Sincronizar automáticamente a todos los empleados actuales del Discord en la pestaña Empleados
      await syncGuildEmployeesToDb().catch(err =>
        console.error("⚠️ Error sincronizando empleados del servidor:", err.message)
      );

      updateBotPresence();
      startAntiFarmingMonitor();

      try {
        await rest.put(Routes.applicationCommands(appId), { body: [] });
        for (const [guildId, guild] of client.guilds.cache) {
          await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
          console.log(`✅ [Bot Discord] Comandos, rol RRHH y permisos sincronizados en servidor: ${guild.name}`);
        }
      } catch (regErr) {
        console.error("⚠️ Error registrando comandos:", regErr.message);
      }
    });

    client.on("guildCreate", async guild => {
      try {
        const appId = client.user.id;
        await ensureRRHHRole(guild);
        await rest.put(Routes.applicationGuildCommands(appId, guild.id), { body: commands });
        await ensureApplicationLogChannels(guild);
      } catch (err) {
        console.error("⚠️ Error registrando comandos en nuevo servidor:", err.message);
      }
    });

    await client.login(token);
  } catch (err) {
    console.error("❌ Error conectando el bot de Discord:", err.message);
  }
}

function getBotStatus() {
  return {
    connected: isBotConnected,
    tag: isBotConnected && client.user ? client.user.tag : "Imperion Security#4005",
    ping: isBotConnected && client.ws ? client.ws.ping : 24
  };
}

module.exports = {
  startDiscordBot,
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
};
