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

// Smart Message & Ticket Detective Listener
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  const content = message.content.toLowerCase();
  const channelName = message.channel.name ? message.channel.name.toLowerCase() : '';
  const isTicketChannel = channelName.includes('ticket') || channelName.includes('support');

  // Check if the user is saying they are done inside a ticket channel
  const doneKeywords = ["i'm done", "im done", "i am done", "that's all", "thats all", "done giving", "all good", "finished"];
  const isDone = doneKeywords.some(phrase => content.includes(phrase));

  if (isTicketChannel && isDone) {
    await message.reply(`Thank you for giving your reasons, <@${message.author.id}>! Staff are going to check this ticket, review the info, and get back to you shortly. Hang tight! 🎫✨`);
    return;
  }

  // If we are inside a ticket channel and they are describing an issue or talking to the bot
  if (isTicketChannel) {
    // Detective mode: ask deeper investigative questions to gather every single detail
    await message.reply(`🕵️‍♂️ **Detective Bot:** Thanks for the details, <@${message.author.id}>! To help staff solve this even faster, could you tell me: **When exactly did this happen, and do you have any screenshots or error messages?** (When you've provided all your reasons and details, just say *"I'm done"*!)`);
    return;
  }

  // If outside a ticket channel (e.g., general chat), only respond when the bot is mentioned (@NEKOSMP)
  if (message.mentions.has(client.user)) {
    const issueKeywords = ['issue', 'problem', 'trouble', 'bug', 'lag', 'bad experience', 'grief', 'ban', 'hack', 'stuck', 'error'];
    const hasIssue = issueKeywords.some(keyword => content.includes(keyword));

    if (hasIssue) {
      // General chat issue redirect
      await message.reply(`Hey <@${message.author.id}>! If you are having trouble with the server or had a bad experience, please go to **#🎟️│create-a-ticket** and please give **every detail as possible** so our staff can help you quickly! 🎫`);
    } else {
      // Normal general chat conversation (math, greetings, general questions)
      await message.reply(`Hey <@${message.author.id}>! NekoSMP is running smoothly 🚀. How can I help you today?`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
