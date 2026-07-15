const { 
  Client, 
  GatewayIntentBits, 
  Events, 
  EmbedBuilder, 
  PermissionsBitField,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const config = require('./config.js');
const db = require('./utils/database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Funzioni di calcolo punteggio integrate (senza bisogno di Tesseract/Sharp!)
function getPlacementMultiplier(placement) {
  if (placement === 1) return 1.6;
  if (placement >= 2 && placement <= 5) return 1.4;
  if (placement >= 6 && placement <= 10) return 1.2;
  return 1.0; // 11° posto in poi
}

function calculatePoints(kills, placement) {
  const totalKills = kills || 0;
  const multiplier = getPlacementMultiplier(placement);
  const points = totalKills * multiplier;
  return Math.round(points * 10) / 10; // Arrotonda a 1 decimale
}

client.once(Events.ClientReady, () => {
  console.log(`✅ Warzone Tournament Bot online come ${client.user.tag}`);
});

// GESTIONE DELLE INTERAZIONI (Comandi, Bottoni e Moduli)
client.on(Events.InteractionCreate, async (interaction) => {
  
  // 1. COMANDI SLASH
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // COMANDO: TORNEO-CREA
    if (commandName === 'torneo-crea') {
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ Solo gli admin possono creare tornei!', ephemeral: true });
      }
      const name = interaction.options.getString('nome');
      const channel = interaction.options.getChannel('canale');

      try {
        await db.createTournament(name, interaction.guildId, channel.id);
        const embed = new EmbedBuilder()
          .setColor('#0099FF')
          .setTitle('🏆 Torneo Creato')
          .setDescription(`**${name}** è ora attivo!`)
          .addFields({ name: '📍 Canale Leaderboard', value: `<#${channel.id}>`, inline: true })
          .setTimestamp();
        await interaction.reply({ embeds: [embed] });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ Errore durante la creazione del torneo nel database.', ephemeral: true });
      }
    }

    // COMANDO: REGISTRA-SQUADRA (La tua nuova funzione Trio)
    else if (commandName === 'registra-squadra') {
      const nomeTeam = interaction.options.getString('nome_team');
      const capitano = interaction.options.getUser('capitano');
      const membro2 = interaction.options.getUser('membro_2');
      const membro3 = interaction.options.getUser('membro_3');

      try {
        const existingTeam = await db.getTeamByName(nomeTeam);
        if (existingTeam) {
          return interaction.reply({ content: `❌ Il team **${nomeTeam}** è già registrato!`, ephemeral: true });
        }

        // Inserimento team e player nel DB
        const teamId = await db.addTeam(nomeTeam, capitano.id);
        await db.addPlayer(capitano.id, capitano.username, teamId);
        await db.addPlayer(membro2.id, membro2.username, teamId);
        await db.addPlayer(membro3.id, membro3.username, teamId);

        // Bottone persistente per inviare i risultati
        const submitBtn = new ButtonBuilder()
          .setCustomId('invia_risultato')
          .setLabel('🎮 Invia Risultato Match')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(submitBtn);

        const embed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle(`🏆 Squadra Registrata: ${nomeTeam}`)
          .setDescription(`La registrazione è avvenuta con successo!`)
          .addFields(
            { name: '👑 Capitano', value: `<@${capitano.id}>`, inline: true },
            { name: '👥 Membro 2', value: `<@${membro2.id}>`, inline: true },
            { name: '👥 Membro 3', value: `<@${membro3.id}>`, inline: true }
          )
          .setFooter({ text: 'Usa il bottone qui sotto dopo ogni partita per inserire i dati del match.' });

        await interaction.reply({ embeds: [embed], components: [row] });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ Errore nella registrazione della squadra.', ephemeral: true });
      }
    }

    // COMANDO: CLASSIFICA
    else if (commandName === 'classifica') {
      try {
        const tournament = await db.getTournament(interaction.guildId);
        if (!tournament) {
          return interaction.reply('❌ Nessun torneo attivo in questo server!');
        }
        const leaderboard = await db.getLeaderboard(tournament.id);
        if (leaderboard.length === 0) {
          return interaction.reply('📊 Nessun risultato registrato o approvato ancora!');
        }
        
        let description = '';
        leaderboard.forEach((team, index) => {
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '•';
          description += `${medal} **#${index + 1}** ${team.team_name}\n`;
          description += `   🎯 **Kill totali: ${team.total_kills}** | ⭐ Punti totali: **${team.total_points}** | 🎮 Partite: ${team.games_played}\n`;
          description += `   🏆 Pos. Media: #${team.avg_placement} | Miglior pos: #${team.best_placement}\n\n`;
        });

        const embed = new EmbedBuilder()
          .setColor('#FFD700')
          .setTitle(`🏆 Classifica - ${tournament.name}`)
          .setDescription(description)
          .setFooter({ text: 'Aggiornata in tempo reale' })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } catch (err) {
        console.error(err);
        await interaction.reply('❌ Errore nel caricamento della classifica.');
      }
    }

    // COMANDO: TORNEO-CHIUDI
    else if (commandName === 'torneo-chiudi') {
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ Solo gli admin!', ephemeral: true });
      }
      try {
        const tournament = await db.getTournament(interaction.guildId);
        if (!tournament) return interaction.reply('❌ Nessun torneo attivo.');
        await db.closeTournament(tournament.id);
        await interaction.reply('🔒 Torneo chiuso! Risultati finalizzati.');
      } catch (err) {
        console.error(err);
        await interaction.reply('❌ Errore durante la chiusura del torneo.');
      }
    }
  }

  // 2. PRESSIONE BOTTONI
  else if (interaction.isButton()) {
    const customId = interaction.customId;

    // Bottone "Invia Risultato" cliccato da un player
    if (customId === 'invia_risultato') {
      try {
        const team = await db.getPlayerTeam(interaction.user.id);
        if (!team) {
          return interaction.reply({ 
            content: '❌ Non risulti registrato in nessuna squadra! Chiedi al capitano di registrarti usando `/registra-squadra`.', 
            ephemeral: true 
          });
        }

        // Mostra il modulo pop-up
        const modal = new ModalBuilder()
          .setCustomId('invia_match_modal')
          .setTitle('Invia Risultati Match');

        const placementInput = new TextInputBuilder()
          .setCustomId('placement')
          .setLabel('Posizionamento Squadra (es: 1, 5, 12...)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const k1Input = new TextInputBuilder()
          .setCustomId('kill_p1')
          .setLabel('Kill Giocatore 1 (Tu o compagno)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const k2Input = new TextInputBuilder()
          .setCustomId('kill_p2')
          .setLabel('Kill Giocatore 2')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const k3Input = new TextInputBuilder()
          .setCustomId('kill_p3')
          .setLabel('Kill Giocatore 3')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(placementInput),
          new ActionRowBuilder().addComponents(k1Input),
          new ActionRowBuilder().addComponents(k2Input),
          new ActionRowBuilder().addComponents(k3Input)
        );

        await interaction.showModal(modal);
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ Si è verificato un errore.', ephemeral: true });
      }
    }

    // Bottone "Approva" cliccato dall'admin
    else if (customId.startsWith('approve_')) {
      const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                      interaction.member.roles.cache.has(config.adminRoleId);
      if (!isAdmin) {
        return interaction.reply({ content: '❌ Non hai i permessi per verificare i match!', ephemeral: true });
      }

      const matchId = customId.split('_')[1];

      try {
        const match = await db.getMatchById(matchId);
        if (!match) return interaction.reply({ content: '❌ Match non trovato.', ephemeral: true });

        // Approva nel database
        await db.verifyMatch(matchId, interaction.user.id);

        // Trova il team
        const team = await new Promise((resolve, reject) => {
          db.get('SELECT * FROM teams WHERE id = ?', [match.team_id], (err, row) => {
            if (err) reject(err); else resolve(row);
          });
        });

        // Aggiorna l'embed nel canale admin per mostrare il successo
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor('#00FF00')
          .setTitle(`✅ Match #${matchId} APPROVATO - Team: ${team.name}`)
          .setFooter({ text: `Approvato da ${interaction.user.username}` });

        await interaction.update({
          content: `✅ Match #${matchId} approvato con successo da <@${interaction.user.id}>!`,
          embeds: [updatedEmbed],
          components: []
        });

        // Notifica il canale della squadra cercando un canale che contiene il nome del team
        const targetChannel = interaction.guild.channels.cache.find(c => 
          c.name.toLowerCase().includes(team.name.toLowerCase().replace(/\s+/g, '-'))
        );
        if (targetChannel) {
          await targetChannel.send(`✅ **Grande notizia!** Il vostro risultato di **${match.points} punti** (Posizione: #${match.placement}, Kill: ${match.kills}) è stato **approvato** dagli admin! La classifica è stata aggiornata. 🏆`);
        }
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ Errore durante l\'approvazione.', ephemeral: true });
      }
    }

    // Bottone "Rifiuta" cliccato dall'admin
    else if (customId.startsWith('reject_')) {
      const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                      interaction.member.roles.cache.has(config.adminRoleId);
      if (!isAdmin) {
        return interaction.reply({ content: '❌ Non hai i permessi!', ephemeral: true });
      }

      const matchId = customId.split('_')[1];

      // Apre un modulo all'admin per chiedere il motivo
      const rejectModal = new ModalBuilder()
        .setCustomId(`reject_modal_${matchId}`)
        .setTitle(`Rifiuta Match #${matchId}`);

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Motivo del Rifiuto')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Es: Le kill inserite non corrispondono alla foto...')
        .setRequired(true);

      rejectModal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(rejectModal);
    }
  }

  // 3. INVIO DEI MODULI (MODAL SUBMIT)
  else if (interaction.isModalSubmit()) {
    const customId = interaction.customId;

    // Invio del modulo risultati da parte del player
    if (customId === 'invia_match_modal') {
      const placement = parseInt(interaction.fields.getTextInputValue('placement'));
      const k1 = parseInt(interaction.fields.getTextInputValue('kill_p1'));
      const k2 = parseInt(interaction.fields.getTextInputValue('kill_p2'));
      const k3 = parseInt(interaction.fields.getTextInputValue('kill_p3'));

      if (isNaN(placement) || isNaN(k1) || isNaN(k2) || isNaN(k3)) {
        return interaction.reply({ content: '❌ Errore: inserisci solo numeri interi per posizione e kill.', ephemeral: true });
      }

      // Rispondi per iniziare la fase di raccolta screenshot
      await interaction.reply({
        content: `📊 **Dati Ricevuti!**\n🏆 **Posizionamento:** #${placement}\n🎯 **Kill totali:** ${k1 + k2 + k3} (${k1} + ${k2} + ${k3})\n\n📸 **Ora trascina e invia qui sotto gli screenshot di verifica (da 1 a 2).**\n*Scrivi **fatto** in chat quando hai terminato di caricarli.*`,
        ephemeral: false
      });

      // Avvia il collettore dinamico di messaggi nel canale per catturare le immagini
      const filter = m => m.author.id === interaction.user.id;
      const collector = interaction.channel.createMessageCollector({ filter, time: 180000 }); // Max 3 minuti

      let screenshots = [];
      let timeout = setTimeout(() => collector.stop('timeout'), 20000); // Scade dopo 20s se non invia nulla

      collector.on('collect', async m => {
        if (m.content.toLowerCase() === 'fatto') {
          collector.stop('user_done');
          return;
        }

        if (m.attachments.size > 0) {
          m.attachments.forEach(att => {
            if (att.contentType?.startsWith('image/')) {
              screenshots.push(att.url);
            }
          });

          // Resetta il timer: aspetta altri 12 secondi dopo l'ultimo screenshot caricato prima di chiudere in automatico
          clearTimeout(timeout);
          timeout = setTimeout(() => collector.stop('timeout'), 12000);

          await m.reply(`📸 Ricevuto! Screenshot caricati: **${screenshots.length}**.\n*Invia il secondo screenshot se necessario, oppure scrivi **fatto** se hai terminato.*`);
        }
      });

      collector.on('end', async (collected, reason) => {
        clearTimeout(timeout);

        if (screenshots.length === 0) {
          return interaction.channel.send(`❌ <@${interaction.user.id}>, tempo scaduto o nessun file immagine allegato. Clicca di nuovo sul bottone per ricominciare.`);
        }

        const processingMsg = await interaction.channel.send('⏳ Invio dei dati agli admin in corso...');

        try {
          const team = await db.getPlayerTeam(interaction.user.id);
          const tournament = await db.getTournament(interaction.guildId);

          if (!tournament) {
            return processingMsg.edit('❌ Nessun torneo attivo in questo momento.');
          }

          const totalKills = k1 + k2 + k3;
          const multiplier = getPlacementMultiplier(placement);
          const points = calculatePoints(totalKills, placement);

          // Salva la partita nel DB (non ancora verificata: verified = 0)
          const screenshotUrl = screenshots.join(',');
          const matchId = await db.addMatch(team.id, tournament.id, totalKills, placement, multiplier, points, screenshotUrl);

          // Invia la notifica nel canale admin di controllo
          const adminChannel = interaction.guild.channels.cache.get(config.adminChannelId);
          if (!adminChannel) {
            return processingMsg.edit('❌ Errore: Il canale di controllo degli admin non è configurato. Contatta un amministratore del server.');
          }

          const adminEmbed = new EmbedBuilder()
            .setColor('#FF9900')
            .setTitle(`🚨 Verifica Match #${matchId} - Team: ${team.name}`)
            .setDescription(`Risultati caricati nel canale <#${interaction.channelId}> da <@${interaction.user.id}>.`)
            .addFields(
              { name: '👥 Team', value: `**${team.name}**`, inline: true },
              { name: '🏆 Posizionamento', value: `#${placement}`, inline: true },
              { name: '🎯 Kill Totali Squadra', value: `${totalKills} (${k1} + ${k2} + ${k3})`, inline: true },
              { name: '⚡ Moltiplicatore', value: `x${multiplier}`, inline: true },
              { name: '⭐ Punti Calcolati', value: `**${points}**`, inline: true }
            )
            .setImage(screenshots[0])
            .setTimestamp();

          let extraEmbeds = [];
          if (screenshots.length > 1) {
            for (let i = 1; i < screenshots.length; i++) {
              extraEmbeds.push(new EmbedBuilder().setURL('https://discord.js.org').setImage(screenshots[i]));
            }
          }

          const approveBtn = new ButtonBuilder()
            .setCustomId(`approve_${matchId}`)
            .setLabel('Approva ✅')
            .setStyle(ButtonStyle.Success);

          const rejectBtn = new ButtonBuilder()
            .setCustomId(`reject_${matchId}`)
            .setLabel('Rifiuta ❌')
            .setStyle(ButtonStyle.Danger);

          const actionRow = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

          await adminChannel.send({
            content: `⚠️ Nuova richiesta di approvazione per il team **${team.name}**`,
            embeds: [adminEmbed, ...extraEmbeds],
            components: [actionRow]
          });

          await processingMsg.edit(`✅ Risultati registrati con successo e inviati agli admin per la convalida!\n📊 **Match ID:** #${matchId}\n*Riceverete una notifica qui non appena il match sarà approvato.*`);

        } catch (error) {
          console.error(error);
          await processingMsg.edit('❌ Errore nell\'invio del match agli admin.');
        }
      });
    }

    // Invio del modulo di rifiuto da parte dell'admin
    else if (customId.startsWith('reject_modal_')) {
      const matchId = customId.split('_')[2];
      const reason = interaction.fields.getTextInputValue('reason');

      try {
        const match = await db.getMatchById(matchId);
        if (!match) return interaction.reply({ content: '❌ Match non trovato.', ephemeral: true });

        const team = await new Promise((resolve, reject) => {
          db.get('SELECT * FROM teams WHERE id = ?', [match.team_id], (err, row) => {
            if (err) reject(err); else resolve(row);
          });
        });

        // Elimina il match dal DB per permettere al team di ricaricarlo
        await db.deleteMatch(matchId);

        // Aggiorna l'embed admin mostrando che è stato rifiutato
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor('#FF0000')
          .setTitle(`❌ Match #${matchId} RIFIUTATO - Team: ${team.name}`)
          .addFields({ name: '🚫 Motivo del Rifiuto', value: reason })
          .setFooter({ text: `Rifiutato da ${interaction.user.username}` });

        await interaction.update({
          content: `❌ Richiesta di approvazione rifiutata da <@${interaction.user.id}>.`,
          embeds: [updatedEmbed],
          components: []
        });

        // Notifica il canale dello slot del team
        const targetChannel = interaction.guild.channels.cache.find(c => 
          c.name.toLowerCase().includes(team.name.toLowerCase().replace(/\s+/g, '-'))
        );
        if (targetChannel) {
          await targetChannel.send(`⚠️ **Attenzione <@${team.captain_discord_id}>!** Il vostro risultato (Piazzamento: #${match.placement}, Kill: ${match.kills}) è stato **rifiutato** dagli admin.\n\n🚫 **Motivo:** ${reason}\n\n👉 Potete correggere i dati e ricaricarlo cliccando nuovamente sul bottone **Invia Risultato Match** qui sopra!`);
        }

      } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ Errore durante l\'elaborazione del rifiuto.', ephemeral: true });
      }
    }
  }
});

// REGISTRAZIONE COMANDI SLASH (Eseguito all'avvio)
const commands = [
  {
    name: 'torneo-crea',
    description: 'Crea un nuovo torneo',
    options: [
      { name: 'nome', type: 3, description: 'Nome del torneo', required: true },
      { name: 'canale', type: 7, description: 'Canale per la leaderboard finale', required: true }
    ]
  },
  {
    name: 'registra-squadra',
    description: 'Registra un team trio e crea il bottone dei risultati',
    options: [
      { name: 'nome_team', type: 3, description: 'Nome del team', required: true },
      { name: 'capitano', type: 6, description: 'Seleziona il Capitano', required: true },
      { name: 'membro_2', type: 6, description: 'Seleziona il secondo giocatore', required: true },
      { name: 'membro_3', type: 6, description: 'Seleziona il terzo giocatore', required: true }
    ]
  },
  {
    name: 'classifica',
    description: 'Mostra la classifica del torneo attivo'
  },
  {
    name: 'torneo-chiudi',
    description: 'Chiudi il torneo attivo'
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
    console.log('✅ Comandi registrati correttamente!');
  } catch (error) {
    console.error(error);
  }
})();

client.login(config.token);
