// Verifikasi autocomplete lewat gateway Discord yang sesungguhnya.
//
// Yang TIDAK bisa diuji tanpa mengetik di klien: Discord tidak mengirim
// AutocompleteInteraction kecuali ada user yang benar-benar mengetik. Jadi yang diuji di
// sini adalah kontraknya: command /play yang terdaftar di Discord memang punya
// autocomplete aktif di option query, dan bot online serta merespons.
//
// `node test/autocomplete-e2e.js`
require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (c) => {
  console.log(`[e2e] online: ${c.user.tag}`);
  try {
    const guild = await c.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const cmds = await guild.commands.fetch();
    const play = cmds.find((x) => x.name === "play");
    if (!play) throw new Error("/play tidak terdaftar di guild");
    const q = play.options.find((o) => o.name === "query");
    console.log(`[e2e] /play query → autocomplete=${q.autocomplete}, required=${q.required}`);
    console.log(`[e2e] total command terdaftar: ${cmds.size}`);
    if (!q.autocomplete) throw new Error("option query TIDAK punya autocomplete aktif");
    console.log("[e2e] OK: /play terdaftar dengan autocomplete aktif");
    client.destroy();
  } catch (e) {
    console.error("[e2e] GAGAL:", e.message);
    process.exitCode = 1;
    client.destroy();
  }
});

client.login(process.env.DISCORD_TOKEN);
