# IMPERION Security — Bot de Discord 24/7 + Panel Enterprise (GTAHub Orion)

Sistema todo-en-uno diseñado para reemplazar **Carl-bot**, **Clock by CoreBots.guru**, **Ticket King**, **Ticket Tool**, **Tickets v2**, etc. con un único Bot propio + Dashboard Web sincronizado en tiempo real.

---

## 1. Cómo crear el Bot en Discord y obtener tu Token (2 minutos)

1. Entrá a **[Discord Developer Portal](https://discord.com/developers/applications)** y tocá **New Application**.
2. Ponele de nombre `IMPERION Security` y subile el logo de la empresa.
3. En el menú izquierdo entrá a **OAuth2**:
   * Copiá el **Client ID** y pegalo en el archivo `.env` donde dice `CLIENT_ID=`.
4. En el menú izquierdo entrá a **Bot**:
   * Tocá **Reset Token**, copiá el Token y pegalo en `.env` donde dice `DISCORD_TOKEN=`.
   * Bajá un poquito y activá los 3 botones de **Privileged Gateway Intents** (*Presence Intent*, *Server Members Intent* y *Message Content Intent*) y dale a **Save Changes**.
5. Para invitar el bot al servidor, pegá este link en tu navegador (reemplazando `TU_CLIENT_ID` por el número del paso 3):
   ```
   https://discord.com/api/oauth2/authorize?client_id=TU_CLIENT_ID&permissions=8&scope=bot%20applications.commands
   ```

---

## 2. Cómo configurarlo adentro de Discord

Una vez que el bot esté adentro del servidor, simplemente usá el comando:
* `/configurar-canales`: Seleccioná ahí mismo cuál es el rol `@Empleados`, el canal `#clock`, el canal `#actividades-disponibles`, `#bonos` y `#reuniones`.
* `/clock`: Publica el panel fijo con los 6 botones (`Entrada`, `Salida`, `Trabajando actualmente`, `Mi Tiempo Total`, `📊 Mis Estadísticas` y `Panel de Administración`).
* `/panel-tickets`: Publica el panel fijo de Tickets para Postulaciones, Contratación de Seguridad y Soporte.

---

## 3. Cómo alojarlo 24/7 GRATIS sin gastar un peso (Render + UptimeRobot)

1. Subí esta carpeta a un repositorio privado en tu cuenta de **GitHub**.
2. Entrá a **[Render.com](https://render.com/)** (Gratis, sin tarjeta) → **New +** → **Web Service** y conectá ese repositorio de GitHub.
3. En la sección **Environment Variables** de Render cargá:
   * `DISCORD_TOKEN` = (El token de tu bot)
   * `CLIENT_ID` = (El Client ID de tu bot)
   * `GUILD_ID` = (El ID del servidor de Discord)
   * `TIMEZONE` = `America/Argentina/Buenos_Aires`
4. Una vez desplegado, Render te va a dar tu link web (ej: `https://imperion-security.onrender.com`):
   * Si entrás a ese link desde el navegador o celular, **se abre el Panel de Control Enterprise en vivo**.
5. Para que nunca se duerma a los 15 minutos, entrá gratis a **[UptimeRobot.com](https://uptimerobot.com/)** o **[cron-job.org](https://cron-job.org/)**, creá un monitor HTTP(s) apuntando a:
   ```
   https://tu-link.onrender.com/health
   ```
   configurado cada **5 minutos**. ¡Con eso queda prendido 24/7 para siempre!
