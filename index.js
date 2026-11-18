const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
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
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log('Successfully registered /ping and /say commands.');
  } catch (error) {
    console.error(error);
  }
});

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
});

// Ticket Auto-Greeting Listener (When ticket channels are created)
client.on('channelCreate', async channel => {
  if (channel.type === ChannelType.GuildText) {
    const name = channel.name.toLowerCase();
    if (name.includes('ticket') || name.includes('support')) {
      setTimeout(async () => {
        try {
          const ticketEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🎫 NekoSMP Support Ticket')
            .setDescription('Welcome to your support channel! Staff will be with you shortly.\n\nTo help us resolve your issue faster, please provide:')
            .addFields(
              { name: '👤 Minecraft Username', value: '`Your In-Game Name`', inline: true },
              { name: '❓ Issue Type', value: 'Bug, ban appeal, donation, or griefing?', inline: true },
              { name: '📝 Details / Proof', value: 'Describe what happened and share screenshots if you have them.' }
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

// Track how many messages a user sends in a ticket so Detective Mode doesn't repeat itself
const ticketStepTracker = new Map();

// Smart Message & Ticket Detective Listener
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Strip the bot mention out of the text so we can read the actual message cleanly
  const cleanText = message.content.replace(/<@!?\d+>/g, '').trim().toLowerCase();
  const channelName = message.channel.name ? message.channel.name.toLowerCase() : '';
  const isTicketChannel = channelName.includes('ticket') || channelName.includes('support');

  // ==========================================
  // 1. INSIDE A TICKET CHANNEL
  // ==========================================
  if (isTicketChannel) {
    // Check if the user is saying they are finished
    const doneKeywords = ["i'm done", "im done", "i am done", "that's all", "thats all", "done giving", "all good", "finished"];
    const isDone = doneKeywords.some(phrase => cleanText.includes(phrase));

    if (isDone) {
      ticketStepTracker.delete(message.channel.id); // Reset tracker for this channel
      await message.reply(`Thank you for giving your reasons, <@${message.author.id}>! Staff are going to check this ticket, review all the info you shared, and get back to you shortly. Hang tight! 🎫✨`);
      return;
    }

    // Detective Mode: Vary the follow-up questions based on how many messages they've sent in the ticket
    const currentStep = ticketStepTracker.get(message.channel.id) || 1;
    ticketStepTracker.set(message.channel.id, currentStep + 1);

    if (currentStep === 1) {
      await message.reply(`🕵️‍♂️ **Detective Mode:** Okay, noted! To help staff investigate this properly, **when did this happen, and were any other players involved?** *(Add any extra details or screenshots, and say **"I'm done"** when you're finished!)*`);
    } else if (currentStep === 2) {
      await message.reply(`🕵️‍♂️ **Detective Mode:** Got it, adding that to your case file. **Did you see any error messages, or do you have coordinates/proof to attach?** *(If that's everything, just type **"I'm done"**!)*`);
    } else {
      await message.reply(`📝 Noted and added to the ticket! Feel free to share more info, or type **"I'm done"** whenever you're ready for staff to review.`);
    }
    return;
  }

  // ==========================================
  // 2. OUTSIDE TICKET CHANNELS (GENERAL CHAT)
  // ==========================================
  if (message.mentions.has(client.user)) {
    // A. Issue / Help redirect
    const issueKeywords = ['issue', 'problem', 'trouble', 'bug', 'lag', 'bad experience', 'grief', 'ban', 'hack', 'stuck', 'error', 'help'];
    if (issueKeywords.some(keyword => cleanText.includes(keyword))) {
      await message.reply(`Hey <@${message.author.id}>! If you're having an issue on the server, please open a ticket in **#🎟️│create-a-ticket** and share **every detail possible** so staff can sort it out for you! 🎫`);
      return;
    }

    // B. Season 2 / Maintenance questions
    if (cleanText.includes('season 2') || cleanText.includes('maintenance') || cleanText.includes('december')) {
      await message.reply(`Season 2 is right around the corner, <@${message.author.id}>! Remember, the server goes down for 24-hour maintenance on **December 1** to upgrade hosts and add the new Spawn Lobby, then reopens on **December 2**! ⛏️✨`);
      return;
    }

    // C. Simple Math Evaluator (e.g., "what's 54 + 6")
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

    // D. Greetings
    if (/\b(hi|hello|hey|yo|sup|whats up|what's up)\b/.test(cleanText)) {
      const greetings = [
        `Hey <@${message.author.id}>! What's going on? 👋`,
        `Yo <@${message.author.id}>! Good to see you around NekoSMP. 😄`,
        `Hey there <@${message.author.id}>! Ready for Season 2? ⛏️`
      ];
      const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
      await message.reply(randomGreeting);
      return;
    }

    // E. Questions (anything ending with '?' or starting with question words)
    if (cleanText.includes('?') || /^(what|why|how|when|who|where|can|is|do|are)\b/.test(cleanText)) {
      const questionReplies = [
        `Good question, <@${message.author.id}>! Check **#📢│announcements** or **#📊│polls** if it's about server updates, otherwise ask a staff member! 👀`,
        `Hmm, not 100% sure on that one, <@${message.author.id}>—try asking in chat or opening a ticket if you need staff info! 🤔`,
        `I'm just a humble server bot, <@${message.author.id}>, so I might not know everything—what do the others think? 💬`
      ];
      const randomQuestionReply = questionReplies[Math.floor(Math.random() * questionReplies.length)];
      await message.reply(randomQuestionReply);
      return;
    }

    // F. Varied General Chat Fallbacks (Never repeats the same line every time!)
    const generalReplies = [
      `I hear you, <@${message.author.id}>! 👀`,
      `Need something, <@${message.author.id}>? You can always use \`/ping\` or \`/say\`! ✨`,
      `Reporting for duty, <@${message.author.id}>! What's on your mind? 🚀`,
      `NekoSMP vibes are strong today, <@${message.author.id}>! 🐱⛏️`
    ];
    const randomReply = generalReplies[Math.floor(Math.random() * generalReplies.length)];
    await message.reply(randomReply);
  }
});

client.login(process.env.DISCORD_TOKEN);
