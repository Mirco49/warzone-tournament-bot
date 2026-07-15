const { Client, GatewayIntentBits, Events, EmbedBuilder, PermissionsBitField, REST, Routes } = require('discord.js');
const config = require('./config.js');
const db = require('./utils/database');
const { extractWarzoneData, calculatePoints, getPlacementMultiplier } = require('./utils/ocr');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ]
});

// Mappa tornei attivi in memoria
const activeTournaments = new Map();

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot connesso come ${client.user.tag}`);
  
  // Carica tornei attivi dal DB
  // (opzionale, per persistenza)
});

// ==================== GESTIONE SCREENSHOT ====================

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.attachments.size === 0) return;

  const tournament = activeTournaments.get(message.guildId);
  if (!tournament) return;
  if (message.channelId !== tournament.channelId) return;

  const attachment = message.attachments.first();
  if (!attachment.contentType?.startsWith('image/')) {
    return message.reply('❌ Invia solo immagini (PNG, JPG)');
  }

  // Verifica che il mittente sia capitano di una squadra
  const team = await db.getTeamByCaptain(message.author.id);
  if (!team) {
    return message.reply('❌ Solo i capitani di squadra possono inviare screenshot!');
  }

  const processingMsg = await message.reply('🔍 Analizzo la screenshot di Warzone...');

  try {
    const gameData = await extractWarzoneData(attachment.url);

    if (gameData.kills === null && gameData.placement === null) {
      await processingMsg.edit('❌ Non ho letto kills né posizionamento. Assicurati che la screenshot mostri chiaramente entrambi i dati.\n\n💡 **Tip**: La schermata post-partita di Warzone mostra i dati in alto. Invia screenshot nitido senza filtri.');
      return;
    }

    const multiplier = getPlacementMultiplier(gameData.placement || 99);
    const points = calculatePoints(gameData.kills, gameData.placement);

    // Salva nel DB
    const matchId = await db.addMatch(
      team.id,
      tournament.id,
      gameData.kills || 0,
      gameData.placement || 0,
      multiplier,
      points,
      attachment.url
    );

    // Embed conferma
    const confirmEmbed = new EmbedBuilder()
      .setColor('#FF6B00')
      .setTitle('🏆 Risultato Warzone Registrato')
      .setDescription(`Squadra: **${team.name}** | Capitano: ${message.author}`)
      .addFields(
        { name: '🎯 Kills Totali', value: `${gameData.kills || 0}`, inline: true },
        { name: '🏆 Posizione', value: `#${gameData.placement || 'N/A'}`, inline: true },
        { name: '🔢 Moltiplicatore', value: `×${multiplier}`, inline: true },
        { name: '⭐ Punti', value: `**${points}**`, inline: true }
      )
      .setImage(attachment.url)
      .setFooter({ text: `Match ID: ${matchId} | In attesa di verifica admin` })
      .setTimestamp();

    await processingMsg.edit({ content: '', embeds: [confirmEmbed] });
    await processingMsg.react('✅');
    await processingMsg.react('❌');

    // Salva matchId nel messaggio per la verifica
    processingMsg.matchId = matchId;

  } catch (error) {
    console.error(error);
    await processingMsg.edit('❌ Errore durante l\'elaborazione. Riprova.');
  }
});

// ==================== VERIFICA ADMIN ====================

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  
  const message = reaction.message;
  if (!message.author?.bot) return;
  if (!message.matchId) return;

  const member = await message.guild.members.fetch(user.id);
  const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                  member.roles.cache.has(config.adminRoleId);

  if (!isAdmin) return;

  const match = await db.getMatchById(message.matchId);
  if (!match || match.verified) return;

  if (reaction.emoji.name === '✅') {
    await db.verifyMatch(message.matchId, user.id);
    await message.reply(`✅ Match **#${message.matchId}** verificato da ${user.username}`);
  } else if (reaction.emoji.name === '❌') {
    await db.deleteMatch(message.matchId);
    await message.reply(`❌ Match **#${message.matchId}** rifiutato e eliminato da ${user.username}`);
  }
});

// ==================== COMANDI SLASH ====================

const commands = [
  {
    name: 'torneo-crea',
    description: 'Crea un nuovo torneo Warzone',
    options: [
      { name: 'nome', type: 3, description: 'Nome del torneo', required: true },
      { name: 'canale', type: 7, description: 'Canale per le screenshot', required: true }
    ]
  },
  {
    name: 'squadra-registra',
    description: 'Registra una nuova squadra',
    options: [
      { name: 'nome', type: 3, description: 'Nome della squadra', required: true }
    ]
  },
  {
    name: 'squadra-aggiungi',
    description: 'Aggiungi un giocatore alla tua squadra',
    options: [
      { name: 'utente', type: 6, description: 'Giocatore da aggiungere', required: true }
    ]
  },
  {
    name: 'classifica',
    description: 'Mostra la classifica del torneo'
  },
  {
    name: 'verifica-pendenti',
    description: 'Mostra i match in attesa di verifica (Admin)'
  },
  {
    name: 'torneo-chiudi',
    description: 'Chiudi il torneo e mostra classifica finale (Admin)'
  }
];

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('🔄 Registrazione comandi slash...');
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    console.log('✅ Comandi registrati!');
  } catch (error) {
    console.error(error);
  }
})();

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ==================== TORNEO CREA ====================
  if (interaction.commandName === 'torneo-crea') {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Solo admin!', ephemeral: true });
    }

    const name = interaction.options.getString('nome');
    const channel = interaction.options.getChannel('canale');

    const tournamentId = await db.createTournament(name, interaction.guildId, channel.id);
    
    activeTournaments.set(interaction.guildId, {
      id: tournamentId,
      name: name,
      channelId: channel.id
    });

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🏆 Torneo Warzone Creato')
      .setDescription(`**${name}** è attivo!`)
      .addFields(
        { name: '📍 Canale Screenshot', value: `<#${channel.id}>`, inline: true },
        { name: '📋 Regolamento', value: 'Solo i capitani inviano screenshot\n1° → Kills × 1.6\n2°-5° → Kills × 1.4\n6°-10° → Kills × 1.2\n11°+ → Kills × 1.0' }
      );

    await interaction.reply({ embeds: [embed] });
  }

  // ==================== SQUADRA REGISTRA ====================
  else if (interaction.commandName === 'squadra-registra') {
    const existingTeam = await db.getTeamByCaptain(interaction.user.id);
    if (existingTeam) {
      return interaction.reply({ content: '❌ Sei già capitano di una squadra!', ephemeral: true });
    }

    const name = interaction.options.getString('nome');
    const existingName = await db.getTeamByName(name);
    if (existingName) {
      return interaction.reply({ content: '❌ Nome squadra già in uso!', ephemeral: true });
    }

    const teamId = await db.addTeam(name, interaction.user.id);
    await db.addPlayer(interaction.user.id, interaction.user.username, teamId);

    await interaction.reply(`✅ Squadra **${name}** registrata! Sei il capitano. Usa \`/squadra-aggiungi\` per aggiungere membri.`);
  }

  // ==================== SQUADRA AGGIUNGI ====================
  else if (interaction.commandName === 'squadra-aggiungi') {
    const team = await db.getTeamByCaptain(interaction.user.id);
    if (!team) {
      return interaction.reply({ content: '❌ Non sei capitano di nessuna squadra!', ephemeral: true });
    }

    const user = interaction.options.getUser('utente');
    if (user.id === interaction.user.id) {
      return interaction.reply({ content: '❌ Sei già nella squadra!', ephemeral: true });
    }

    await db.addPlayer(user.id, user.username, team.id);
    await interaction.reply(`✅ ${user} aggiunto alla squadra **${team.name}**!`);
  }

  // ==================== CLASSIFICA ====================
  else if (interaction.commandName === 'classifica') {
    const tournament = activeTournaments.get(interaction.guildId);
    if (!tournament) {
      return interaction.reply('❌ Nessun torneo attivo!');
    }

    const leaderboard = await db.getLeaderboard(tournament.id);

    if (leaderboard.length === 0) {
      return interaction.reply('📊 Nessun risultato verificato ancora!');
    }

    let description = '';
    leaderboard.forEach((team, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '•';
      description += `${medal} **#${index + 1}** ${team.team_name}\n`;
      description += `   🎯 Kills: ${team.total_kills} | ⭐ Punti: **${team.total_points}**\n`;
      description += `   🏆 Miglior pos: #${team.best_placement || 'N/A'} | Partite: ${team.games_played}\n\n`;
    });

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle(`🏆 Classifica - ${tournament.name}`)
      .setDescription(description)
      .addFields({
        name: '📋 Sistema Punteggio',
        value: '🥇 1° → ×1.6 | 🥈 2°-5° → ×1.4 | 🥉 6°-10° → ×1.2 | 📍 11°+ → ×1.0'
      })
      .setFooter({ text: 'Ordinata per punti totali' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ==================== VERIFICA PENDENTI ====================
  else if (interaction.commandName === 'verifica-pendenti') {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Solo admin!', ephemeral: true });
    }

    const tournament = activeTournaments.get(interaction.guildId);
    if (!tournament) {
      return interaction.reply('❌ Nessun torneo attivo!');
    }

    const pending = await db.getPendingMatches(tournament.id);
    if (pending.length === 0) {
      return interaction.reply('✅ Nessun match in attesa di verifica!');
    }

    let description = '';
    pending.forEach(match => {
      description += `**Match #${match.id}** | Squadra: ${match.team_name}\n`;
      description += `🎯 Kills: ${match.kills} | 🏆 Pos: #${match.placement} | ⭐ Punti: ${match.points}\n`;
      description += `[Screenshot](${match.screenshot_url})\n\n`;
    });

    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('⏳ Match in Attesa di Verifica')
      .setDescription(description);

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ==================== TORNEO CHIUDI ====================
  else if (interaction.commandName === 'torneo-chiudi') {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Solo admin!', ephemeral: true });
    }

    const tournament = activeTournaments.get(interaction.guildId);
    if (!tournament) {
      return interaction.reply('❌ Nessun torneo attivo!');
    }

    await db.closeTournament(tournament.id);
    activeTournaments.delete(interaction.guildId);

    const leaderboard = await db.getLeaderboard(tournament.id);
    
    let description = '';
    leaderboard.forEach((team, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '•';
      description += `${medal} **#${index + 1}** ${team.team_name} — **${team.total_points}** punti\n`;
    });

    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle(`🏆 CLASSIFICA FINALE - ${tournament.name}`)
      .setDescription(description)
      .setFooter({ text: 'Torneo concluso' });

    await interaction.reply({ embeds: [embed] });
  }
});

client.login(config.token);
