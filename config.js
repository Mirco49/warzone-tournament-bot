module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  adminRoleId: process.env.ADMIN_ROLE_ID || '',
  adminChannelId: process.env.ADMIN_CHANNEL_ID || '' // Aggiunto per la stanza di controllo
};
