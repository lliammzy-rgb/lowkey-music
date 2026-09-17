require("dotenv").config();
const { REST, Routes } = require("discord.js");
const commands = require("./commands");

const body = commands.map((c) => c.data.toJSON());
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    if (process.env.DISCORD_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body },
      );
      console.log(`Registered ${body.length} guild commands.`);
    } else {
      await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body });
      console.log(`Registered ${body.length} global commands.`);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
