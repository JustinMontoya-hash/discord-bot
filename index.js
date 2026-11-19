const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const express = require('express');

// Web server for Railway health checks
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('NEKOSMP Bot is online and running!');
});

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

// Discord Bot Setup
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

// Slash Commands Registration
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!'),
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Makes NEKOSMP send a message in this channel')
    .addStringOption(input =>
      input
        .setName('message')
        .setDescription('The message the bot should say')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('ticket-info')
    .setDescription('Shows a full summary of all details logged in this ticket channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('guideplayer')
    .setDescription('Activates NekoSMP Bot to actively guide and troubleshoot with the player in this ticket')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(option =>
      option
        .setName('topic')
        .setDescription('Optional: Choose a specific issue to guide them on (or leave blank to auto-detect)')
        .setRequired(false)
        .addChoices(
          { name: 'Auto-Detect from Ticket History', value: 'auto' },
          { name: 'Lag / High Ping', value: 'lag' },
          { name: 'Login / Register / Connection', value: 'login' },
          { name: 'Griefing / Stealing / Rule-Break', value: 'grief' },
          { name: 'Lost Items / Bug / Shop Issue', value: 'bug' },
          { name: 'Ban / Mute Appeal', value: 'ban' }
        )
    ),
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('Successfully registered /ping, /say, /ticket-info, and /guideplayer commands.');
  } catch (error) {
    console.error(error);
  }
});

// Trackers per ticket channel
const ticketLogs = new Map();
const ticketStepTracker = new Map();
const activeGuideMode = new Set();     // Channels where /guideplayer is active
const guideIntroSent = new Set();      // Prevents repeating the "Tell me what is happening" prompt
const botMutedInTicket = new Set();    // Channels where the player told the bot to stop guiding

// Helper function to save messages to the ticket log
function logTicketMessage(channelId, authorTag, content, attachmentCount) {
  if (!ticketLogs.has(channelId)) {
    ticketLogs.set(channelId, {
      openedBy: authorTag,
      createdAt: new Date().toLocaleString(),
      status: 'Open / Gathering Info',
      entries: []
    });
  }
  const log = ticketLogs.get(channelId);
  let entryText = `**${authorTag}:** ${content || '[Attachment only]'}`;
  if (attachmentCount > 0) {
    entryText += ` *(+${attachmentCount} screenshot/file)*`;
  }
  log.entries.push(entryText);
}

// Smart Self-Help Guide Generator (Returns null if no specific category matches!)
function getSpecificGuidance(text) {
  // 1. Lag / Ping / Performance
  if (/\b(lag|lagging|ping|tps|freeze|freezing|fps|slow|delay|crash|crashing)\b/.test(text)) {
    return `🛠️ **Step-by-Step Guide (Lag / High Ping):**\n1. Lower your render distance to **6–8 chunks** in Video Settings.\n2. Close any background downloads/apps using your Wi-Fi.\n3. Note that we are upgrading from Aternos to a dedicated host with way more RAM on **December 1**, which will permanently fix server-side lag!`;
  }
  // 2. Login / Join / Connection / Bedrock & Java
  if (/\b(login|register|password|auth|authme|kick|kicked|join|joining|connect|connecting|ip|port|version|bedrock|java|offline|cant enter|can't enter)\b/.test(text)) {
    return `🛠️ **Step-by-Step Guide (Login / Joining Server):**\n1. If it asks you to register in-game, type \`/register <password> <password>\` in chat.\n2. If you already played before, type \`/login <yourpassword>\`.\n3. If you're stuck on *"Connecting"* or *"Outdated Client"*, double-check the server IP/port in **#📢│announcements** and make sure your game version matches!`;
  }
  // 3. Griefing / Stealing / PvP / Rule-breaking
  if (/\b(grief|griefed|griefing|steal|stole|stolen|chest|house|base|raid|raided|hack|hacker|cheating|xray|x-ray|kill|killed|spawnkill)\b/.test(text)) {
    return `🛠️ **Step-by-Step Guide (Griefing / Stealing / Rule-Break):**\n1. Do **not** touch or rebuild the griefed area yet so staff can inspect the blocks.\n2. Reply with the **exact coordinates (X, Y, Z)** and **what time** it happened.\n3. Drop any screenshots, video clips, or player usernames right here!`;
  }
  // 4. Lost Items / Bugs / Shop / Economy
  if (/\b(lost|lose|item|items|diamond|netherite|gear|armor|bug|glitch|shop|money|balance|bal|sell|buy|command|rtp|tpa|home)\b/.test(text)) {
    return `🛠️ **Step-by-Step Guide (Bug / Lost Items / Shop):**\n1. Reply with **what exact items or money** you lost and **what command or action** caused the issue.\n2. If you have a screenshot of your inventory or chat error, upload it here so staff can verify and restore it!`;
  }
  // 5. Ban / Mute Appeal
  if (/\b(ban|banned|mute|muted|appeal|unban|unmute|punish|punishment)\b/.test(text)) {
    return `🛠️ **Step-by-Step Guide (Ban / Mute Appeal):**\n1. Share your **exact Minecraft username** and **what the ban/mute screen says**.\n2. Explain honestly what happened and why you believe you should be unbanned/unmuted so staff can review your appeal.`;
  }
  return null;
}

// Slash Command Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong! NEKOSMP is online.');
  }

  if (interaction.commandName === 'say') {
    const messageText = interaction.options.getString('message');
    await interaction.reply({ content: 'Sent!', ephemeral: true });
    await interaction.channel.send(messageText);
  }

  if (interaction.commandName === 'ticket-info') {
    const channelId = interaction.channel.id;
    const channelName = interaction.channel.name.toLowerCase();

    if (!channelName.includes('ticket') && !channelName.includes('support')) {
      await interaction.reply({ content: '❌ You can only use `/ticket-info` inside a ticket or support channel!', ephemeral: true });
      return;
    }

    const log = ticketLogs.get(channelId);

    if (!log || log.entries.length === 0) {
      await interaction.reply({ content: '📭 No player messages have been logged in this ticket yet (or the bot restarted since it was opened).', ephemeral: true });
      return;
    }

    const fullHistory = log.entries.join('\n').slice(0, 3800);

    const summaryEmbed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle(`📋 Ticket Case Summary: #${interaction.channel.name}`)
      .addFields(
        { name: '👤 Reported By', value: log.openedBy, inline: true },
        { name: '📌 Current Status', value: log.status, inline: true },
        { name: '📝 Everything Reported', value: fullHistory }
      )
      .setFooter({ text: 'NekoSMP Staff Ticket Intelligence' })
      .setTimestamp();

    await interaction.reply({ embeds: [summaryEmbed] });
  }

  // /guideplayer Staff Command
  if (interaction.commandName === 'guideplayer') {
    const channelId = interaction.channel.id;
    const channelName = interaction.channel.name.toLowerCase();

    if (!channelName.includes('ticket') && !channelName.includes('support')) {
      await interaction.reply({ content: '❌ You can only use `/guideplayer` inside a ticket channel!', ephemeral: true });
      return;
    }

    activeGuideMode.add(channelId);
    botMutedInTicket.delete(channelId);
    guideIntroSent.delete(channelId);

    if (ticketLogs.has(channelId)) {
      ticketLogs.get(channelId).status = '🤖 Bot Actively Guiding Player';
    }

    const chosenTopic = interaction.options.getString('topic') || 'auto';
    let initialGuide = null;

    if (chosenTopic !== 'auto') {
      initialGuide = getSpecificGuidance(chosenTopic);
    } else {
      const log = ticketLogs.get(channelId);
      const historyText = log ? log.entries.join(' ').toLowerCase() : '';
      initialGuide = getSpecificGuidance(historyText);
    }

    await interaction.reply({ content: '✅ Activated **Player Guide Mode** for this ticket!', ephemeral: true });

    if (initialGuide) {
      await interaction.channel.send(
        `🤖 **NekoSMP Guide Activated!** Staff asked me to help walk you through this step-by-step.\n\n${initialGuide}\n\n*(Reply with what happens when you try this! If you'd prefer to wait for a human staff member instead, just say **"stop guiding me"**.)*`
      );
    } else {
      guideIntroSent.add(channelId);
      await interaction.channel.send(
        `🤖 **NekoSMP Guide Activated!** Staff asked me to help you out.\n\nTell me specifically what is happening (for example: *lag, login/joining issue, griefing, lost items, or ban appeal*) and I'll walk you through fixing it!\n\n*(Or say **"stop guiding me"** anytime if you want to wait for human staff.)*`
      );
    }
  }
});

// Ticket Auto-Greeting Listener
client.on('channelCreate', async channel => {
  if (channel.type === ChannelType.GuildText) {
    const name = channel.name.toLowerCase();
    if (name.includes('ticket') || name.includes('support')) {
      setTimeout(async () => {
        try {
          const ticketEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🎫 NekoSMP Support Ticket')
            .setDescription('Welcome to your support channel! Staff will be with you shortly, or I can help guide you right now.\n\nTo help us resolve your issue faster, please share:')
            .addFields(
              { name: '👤 Minecraft Username', value: '`Your In-Game Name`', inline: true },
              { name: '❓ Issue Type', value: 'Bug, lag, login, griefing, or appeal?', inline: true },
              { name: '📝 Details / Proof', value: 'Describe what happened or ask me how to fix it!' }
            )
            .setFooter({ text: 'NekoSMP Automated Support Assistant' })
            .setTimestamp();

          await channel.send({ content: 'Hello! A staff member has been notified.', embeds: [ticketEmbed] });
        } catch (err) {
          console.error('Failed to send ticket greeting:', err);
        }
      }, 1500);
    }
  }
});

// Smart Message & Ticket Detective Listener
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const cleanText = message.content.replace(/<@!?\d+>/g, '').trim().toLowerCase();
  const channelName = message.channel.name ? message.channel.name.toLowerCase() : '';
  const isTicketChannel = channelName.includes('ticket') || channelName.includes('support');
  const isMentioned = message.mentions.has(client.user);

  // ==========================================
  // 1. INSIDE A TICKET CHANNEL
  // ==========================================
  if (isTicketChannel) {
    const channelId = message.channel.id;

    // Log EVERY non-bot message into the ticket's case file for /ticket-info
    logTicketMessage(channelId, message.author.username, message.content, message.attachments.size);

    // Check if the player wants the bot to STOP guiding them and call Staff
    const stopGuidePhrases = [
      "stop guiding", "don't want you to guide", "dont want you to guide",
      "don't want u to guide", "dont want u to guide", "stop helping",
      "stop bot", "want real staff", "talk to staff", "need real staff",
      "not helping", "leave me alone"
    ];
    if (stopGuidePhrases.some(phrase => cleanText.includes(phrase))) {
      activeGuideMode.delete(channelId);
      guideIntroSent.delete(channelId);
      botMutedInTicket.add(channelId);

      if (ticketLogs.has(channelId)) {
        ticketLogs.get(channelId).status = '🙋 Player Requested Human Staff';
      }

      const staffRole = message.guild.roles.cache.find(r =>
        ['staff', 'admin', 'moderator', 'mod', 'helper', 'owner'].some(word => r.name.toLowerCase().includes(word))
      );
      const staffMention = staffRole ? `<@&${staffRole.id}>` : '@here';

      await message.reply(
        `Understood, <@${message.author.id}>! I'll step back and stop guiding right now. 🛑\n\n${staffMention} — <@${message.author.id}> would like a human staff member to assist them in this ticket!`
      );
      return;
    }

    // Stay quiet if muted unless explicitly pinged again
    if (botMutedInTicket.has(channelId) && !isMentioned) {
      return;
    }

    // Check if the user is saying they are finished
    const doneKeywords = ["i'm done", "im done", "i am done", "that's all", "thats all", "done giving", "all good", "finished"];
    if (doneKeywords.some(phrase => cleanText.includes(phrase))) {
      activeGuideMode.delete(channelId);
      guideIntroSent.delete(channelId);
      if (ticketLogs.has(channelId)) {
        ticketLogs.get(channelId).status = '✅ Ready for Staff Review';
      }
      ticketStepTracker.delete(channelId);
      await message.reply(`Thank you for giving your reasons and details, <@${message.author.id}>! I've saved everything to your ticket file. Staff will review this shortly and get back to you! 🎫✨`);
      return;
    }

    // If /guideplayer is ACTIVE in this channel
    if (activeGuideMode.has(channelId)) {
      if (/\b(work|worked|working|fixed|thank|thanks|solved)\b/.test(cleanText)) {
        activeGuideMode.delete(channelId);
        guideIntroSent.delete(channelId);
        await message.reply(`Awesome, glad that helped, <@${message.author.id}>! 🎉 If everything is good now, just type **"I'm done"** so staff know this ticket is ready to wrap up.`);
        return;
      }

      const specificGuide = getSpecificGuidance(cleanText);
      if (specificGuide) {
        await message.reply(
          `${specificGuide}\n\n*(Let me know if that worked, or say **"stop guiding me"** if you'd like me to ping human staff instead!)*`
        );
      } else if (!guideIntroSent.has(channelId)) {
        guideIntroSent.add(channelId);
        await message.reply(
          `🛠️ **NekoSMP Interactive Guide:**\nI'm here to help walk you through your issue! Tell me specifically what is happening (for example: *lag, login/joining issue, griefing, lost items, or ban appeal*) and I'll give you the steps to fix it.\n\n*(Or say **"stop guiding me"** to ping staff!)*`
        );
      } else {
        // Never repeat the intro! Acknowledge their custom message and ask a helpful follow-up
        await message.reply(
          `Got it, <@${message.author.id}>—I've added those details to your ticket! Could you share your **Minecraft username** and any **screenshots or coordinates** if you have them? *(Type **"I'm done"** when finished, or **"stop guiding me"** to ping staff!)*`
        );
      }
      return;
    }

    // Standard Ticket Behavior (when /guideplayer is NOT active):
    const specificGuide = getSpecificGuidance(cleanText);
    if (specificGuide && (isMentioned || cleanText.includes('guide') || cleanText.includes('how') || cleanText.includes('fix') || cleanText.includes('?'))) {
      await message.reply(`${specificGuide}\n\n*(If you've shared all your details, just type **"I'm done"**—or say **"stop guiding me"** to ping staff!)*`);
      return;
    }

    // Detective Mode on the first message or when pinged
    const currentStep = ticketStepTracker.get(channelId) || 1;
    if (currentStep === 1 || isMentioned) {
      ticketStepTracker.set(channelId, currentStep + 1);

      if (currentStep === 1) {
        const autoTip = specificGuide ? `\n\n${specificGuide}` : '';
        await message.reply(`🕵️‍♂️ **Detective Mode:** Got it, <@${message.author.id}>! I've started logging your ticket. **When did this happen, and were any other players involved?**${autoTip}\n\n*(Keep adding details, ask me how to fix it, or say **"I'm done"** when finished!)*`);
      } else {
        await message.reply(`📝 Logged! Anything else to add (screenshots, coordinates, or error messages)? If you're ready for staff, just type **"I'm done"**.`);
      }
    }
    return;
  }

  // ==========================================
  // 2. OUTSIDE TICKET CHANNELS (GENERAL CHAT)
  // ==========================================
  if (isMentioned) {
    const issueKeywords = ['issue', 'problem', 'trouble', 'bug', 'lag', 'bad experience', 'grief', 'ban', 'hack', 'stuck', 'error', 'help'];
    if (issueKeywords.some(keyword => cleanText.includes(keyword))) {
      await message.reply(`Hey <@${message.author.id}>! If you're having an issue on the server, please open a ticket in **#🎟️│create-a-ticket**—I'll help guide you through fixing it or log all your details for staff! 🎫`);
      return;
    }

    if (cleanText.includes('season 2') || cleanText.includes('maintenance') || cleanText.includes('december')) {
      await message.reply(`Season 2 is right around the corner, <@${message.author.id}>! Remember, the server goes down for 24-hour maintenance on **December 1** to upgrade hosts and add the new Spawn Lobby, then reopens on **December 2**! ⛏️✨`);
      return;
    }

    const mathMatch = cleanText.match(/(\d+)\s*([\+\-\*\/])\s*(\d+)/);
    if (mathMatch) {
      const num1 = parseFloat(mathMatch[1]);
      const operator = mathMatch[2];
      const num2 = parseFloat(mathMatch[3]);
      let answer;
      if (operator === '+') answer = num1 + num2;
      if (operator === '-') answer = num1 - num2;
      if (operator === '*') answer = num1 * num2;
      if (operator === '/') answer = num2 !== 0 ? (num1 / num2).toFixed(2) : 'undefined';
      
      await message.reply(`Easy! **${num1} ${operator} ${num2} = ${answer}** 🧮`);
      return;
    }

    if (/\b(hi|hello|hey|yo|sup|whats up|what's up)\b/.test(cleanText)) {
      const greetings = [
        `Hey <@${message.author.id}>! What's going on? 👋`,
        `Yo <@${message.author.id}>! Good to see you around NekoSMP. 😄`,
        `Hey there <@${message.author.id}>! Ready for Season 2? ⛏️`
      ];
      await message.reply(greetings[Math.floor(Math.random() * greetings.length)]);
      return;
    }

    if (cleanText.includes('?') || /^(what|why|how|when|who|where|can|is|do|are)\b/.test(cleanText)) {
      const questionReplies = [
        `Good question, <@${message.author.id}>! Check **#📢│announcements** or **#📊│polls** if it's about server updates, otherwise ask a staff member! 👀`,
        `Hmm, not 100% sure on that one, <@${message.author.id}>—try asking in chat or opening a ticket if you need staff info! 🤔`,
        `I'm just a humble server bot, <@${message.author.id}>, so I might not know everything—what do the others think? 💬`
      ];
      await message.reply(questionReplies[Math.floor(Math.random() * questionReplies.length)]);
      return;
    }

    const generalReplies = [
      `I hear you, <@${message.author.id}>! 👀`,
      `Need something, <@${message.author.id}>? You can always use \`/ping\` or \`/say\`! ✨`,
      `Reporting for duty, <@${message.author.id}>! What's on your mind? 🚀`,
      `NekoSMP vibes are strong today, <@${message.author.id}>! 🐱⛏️`
    ];
    await message.reply(generalReplies[Math.floor(Math.random() * generalReplies.length)]);
  }
});

client.login(process.env.DISCORD_TOKEN);
