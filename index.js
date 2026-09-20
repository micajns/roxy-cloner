require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionsBitField,
    Collection
} = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = "!";
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

const pendingConfirmations = new Collection();

function isAllowed(userId) {
    return ALLOWED_USER_IDS.includes(userId);
}

function log(message) {
    console.log(`[ServerCloner] ${message}`);
}

function errorLog(message, error) {
    console.error(`[ServerCloner] ${message}`, error || "");
}

async function safeDeleteChannel(channel) {
    try {
        await channel.delete();
        return true;
    } catch (error) {
        errorLog(`Failed to delete channel ${channel.name}`, error.message);
        return false;
    }
}

async function safeDeleteRole(role) {
    try {
        if (role.managed) return false;
        if (role.id === role.guild.id) return false;

        await role.delete();
        return true;
    } catch (error) {
        errorLog(`Failed to delete role ${role.name}`, error.message);
        return false;
    }
}

async function clearTargetServer(targetGuild) {
    log(`Clearing target server: ${targetGuild.name}`);

    const existingChannels = [...targetGuild.channels.cache.values()];

    for (const channel of existingChannels) {
        await safeDeleteChannel(channel);
    }

    const existingRoles = [...targetGuild.roles.cache.values()]
        .filter(role => !role.managed && role.id !== targetGuild.id);

    for (const role of existingRoles) {
        await safeDeleteRole(role);
    }

    log("Target server cleared.");
}

async function cloneRoles(sourceGuild, targetGuild) {
    log("Cloning roles...");

    const roleMap = new Map();

    const sourceRoles = [...sourceGuild.roles.cache.values()]
        .filter(role => !role.managed && role.id !== sourceGuild.id)
        .sort((a, b) => a.position - b.position);

    for (const sourceRole of sourceRoles) {
        try {
            const newRole = await targetGuild.roles.create({
                name: sourceRole.name,
                color: sourceRole.color,
                hoist: sourceRole.hoist,
                mentionable: sourceRole.mentionable,
                permissions: sourceRole.permissions.bitfield,
                reason: "Server clone"
            });

            roleMap.set(sourceRole.id, newRole.id);

            log(`Created role: ${sourceRole.name}`);
        } catch (error) {
            errorLog(
                `Failed to create role "${sourceRole.name}"`,
                error.message
            );
        }
    }

    return roleMap;
}

async function cloneCategories(sourceGuild, targetGuild) {
    log("Cloning categories...");

    const categoryMap = new Map();

    const sourceCategories = [...sourceGuild.channels.cache.values()]
        .filter(channel => channel.type === ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);

    for (const sourceCategory of sourceCategories) {
        try {
            const newCategory = await targetGuild.channels.create({
                name: sourceCategory.name,
                type: ChannelType.GuildCategory,
                reason: "Server clone"
            });

            categoryMap.set(sourceCategory.id, newCategory.id);

            log(`Created category: ${sourceCategory.name}`);
        } catch (error) {
            errorLog(
                `Failed to create category "${sourceCategory.name}"`,
                error.message
            );
        }
    }

    return categoryMap;
}

function getChannelType(channel) {
    switch (channel.type) {
        case ChannelType.GuildText:
            return ChannelType.GuildText;

        case ChannelType.GuildVoice:
            return ChannelType.GuildVoice;

        case ChannelType.GuildAnnouncement:
            return ChannelType.GuildAnnouncement;

        case ChannelType.GuildStageVoice:
            return ChannelType.GuildStageVoice;

        case ChannelType.GuildForum:
            return ChannelType.GuildForum;

        default:
            return null;
    }
}

async function cloneChannels(sourceGuild, targetGuild, categoryMap) {
    log("Cloning channels...");

    const sourceChannels = [...sourceGuild.channels.cache.values()]
        .filter(channel => channel.type !== ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);

    for (const sourceChannel of sourceChannels) {
        const channelType = getChannelType(sourceChannel);

        if (!channelType) {
            log(`Skipping unsupported channel: ${sourceChannel.name}`);
            continue;
        }

        try {
            const options = {
                name: sourceChannel.name,
                type: channelType,
                reason: "Server clone"
            };

            if (sourceChannel.parentId) {
                const targetCategoryId =
                    categoryMap.get(sourceChannel.parentId);

                if (targetCategoryId) {
                    options.parent = targetCategoryId;
                }
            }

            if (
                channelType === ChannelType.GuildText ||
                channelType === ChannelType.GuildAnnouncement
            ) {
                if (sourceChannel.topic) {
                    options.topic = sourceChannel.topic;
                }

                options.nsfw = sourceChannel.nsfw;
                options.rateLimitPerUser =
                    sourceChannel.rateLimitPerUser;
            }

            if (
                channelType === ChannelType.GuildVoice ||
                channelType === ChannelType.GuildStageVoice
            ) {
                options.bitrate = sourceChannel.bitrate;
                options.userLimit = sourceChannel.userLimit;

                if (sourceChannel.rtcRegion) {
                    options.rtcRegion = sourceChannel.rtcRegion;
                }
            }

            const newChannel = await targetGuild.channels.create(options);

            log(`Created channel: ${sourceChannel.name}`);

            if (sourceChannel.permissionOverwrites?.cache?.size) {
                for (const overwrite of sourceChannel.permissionOverwrites.cache.values()) {
                    try {
                        if (overwrite.id === sourceGuild.id) {
                            await newChannel.permissionOverwrites.edit(
                                targetGuild.roles.everyone,
                                overwrite.allow.bitfield,
                                {
                                    deny: overwrite.deny.bitfield,
                                    reason: "Server clone"
                                }
                            );

                            continue;
                        }

                        const mappedRoleId = null;

                        if (!mappedRoleId) {
                            continue;
                        }

                        await newChannel.permissionOverwrites.edit(
                            mappedRoleId,
                            {
                                allow: overwrite.allow.bitfield,
                                deny: overwrite.deny.bitfield
                            },
                            {
                                reason: "Server clone"
                            }
                        );
                    } catch (error) {
                        errorLog(
                            `Failed to clone permissions for ${sourceChannel.name}`,
                            error.message
                        );
                    }
                }
            }
        } catch (error) {
            errorLog(
                `Failed to create channel "${sourceChannel.name}"`,
                error.message
            );
        }
    }
}

async function cloneEmojis(sourceGuild, targetGuild) {
    log("Cloning emojis...");

    if (!sourceGuild.emojis?.cache?.size) {
        log("No emojis found.");
        return;
    }

    for (const emoji of sourceGuild.emojis.cache.values()) {
        try {
            if (!emoji.url) continue;

            await targetGuild.emojis.create({
                attachment: emoji.url,
                name: emoji.name,
                reason: "Server clone"
            });

            log(`Created emoji: ${emoji.name}`);
        } catch (error) {
            errorLog(
                `Failed to create emoji "${emoji.name}"`,
                error.message
            );
        }
    }
}

async function cloneServer(sourceGuild, targetGuild) {
    log("----------------------------------------");
    log(`Starting clone`);
    log(`Source: ${sourceGuild.name}`);
    log(`Target: ${targetGuild.name}`);
    log("----------------------------------------");

    await sourceGuild.channels.fetch();
    await targetGuild.channels.fetch();

    await sourceGuild.roles.fetch();
    await targetGuild.roles.fetch();

    log("Step 1/5: Clearing target server...");
    await clearTargetServer(targetGuild);

    log("Step 2/5: Cloning roles...");
    const roleMap = await cloneRoles(sourceGuild, targetGuild);

    log("Step 3/5: Cloning categories...");
    const categoryMap = await cloneCategories(
        sourceGuild,
        targetGuild
    );

    log("Step 4/5: Cloning channels...");
    await cloneChannels(
        sourceGuild,
        targetGuild,
        categoryMap,
        roleMap
    );

    log("Step 5/5: Cloning emojis...");
    await cloneEmojis(sourceGuild, targetGuild);

    log("----------------------------------------");
    log("Clone completed successfully.");
    log("----------------------------------------");
}

async function getGuild(guildId) {
    try {
        return await client.guilds.fetch(guildId);
    } catch (error) {
        return null;
    }
}

client.once("ready", async () => {
    log(`Logged in as ${client.user.tag}`);
    log(`Bot ID: ${client.user.id}`);
    log(`Connected to ${client.guilds.cache.size} guild(s)`);
    log("Bot is ready.");
    log("Listening for clone commands.");
});

client.on("guildCreate", guild => {
    log(`Joined guild: ${guild.name} (${guild.id})`);
});

client.on("guildDelete", guild => {
    log(`Left guild: ${guild.name} (${guild.id})`);
});

client.on("messageCreate", async message => {
    try {
        if (message.author.bot) return;

        if (!message.content.startsWith(PREFIX)) return;

        const args = message.content.trim().split(/\s+/);
        const command = args[0].slice(PREFIX.length).toLowerCase();

        if (command === "help") {
            await message.reply(
                [
                    "**Server Cloner**",
                    "",
                    "`!clone <sourceGuildId> <targetGuildId>`",
                    "Clone a server into another server.",
                    "",
                    "`!status`",
                    "Show bot status.",
                    "",
                    "`!guilds`",
                    "Show the servers the bot can access."
                ].join("\n")
            );

            return;
        }

        if (command === "status") {
            await message.reply(
                `🟢 Online\nServers: **${client.guilds.cache.size}**`
            );

            return;
        }

        if (command === "guilds") {
            if (!isAllowed(message.author.id)) {
                await message.reply("You are not authorized to use this command.");
                return;
            }

            const guilds = [...client.guilds.cache.values()];

            if (!guilds.length) {
                await message.reply("The bot is not connected to any servers.");
                return;
            }

            const text = guilds
                .map(guild => `• ${guild.name} — \`${guild.id}\``)
                .join("\n");

            await message.reply(`**Connected Servers**\n${text}`);

            return;
        }

        if (command !== "clone") return;

        if (!isAllowed(message.author.id)) {
            await message.reply(
                "❌ You are not authorized to use the clone command."
            );

            return;
        }

        if (args.length < 3) {
            await message.reply(
                "Usage: `!clone <sourceGuildId> <targetGuildId>`"
            );

            return;
        }

        const sourceId = args[1];
        const targetId = args[2];

        if (!/^\d{17,20}$/.test(sourceId)) {
            await message.reply("❌ Invalid source server ID.");
            return;
        }

        if (!/^\d{17,20}$/.test(targetId)) {
            await message.reply("❌ Invalid target server ID.");
            return;
        }

        if (sourceId === targetId) {
            await message.reply(
                "❌ The source and target servers must be different."
            );

            return;
        }

        const sourceGuild = await getGuild(sourceId);
        const targetGuild = await getGuild(targetId);

        if (!sourceGuild) {
            await message.reply(
                "❌ I cannot access the source server."
            );

            return;
        }

        if (!targetGuild) {
            await message.reply(
                "❌ I cannot access the target server."
            );

            return;
        }

        const confirmationId =
            `${message.author.id}:${sourceId}:${targetId}`;

        pendingConfirmations.set(confirmationId, {
            userId: message.author.id,
            sourceId,
            targetId,
            createdAt: Date.now()
        });

        await message.reply(
            [
                "⚠️ **Clone Confirmation**",
                "",
                `Source: **${sourceGuild.name}**`,
                `Target: **${targetGuild.name}**`,
                "",
                "This will modify the target server.",
                "",
                "Reply with `yes` to continue.",
                "Reply with `no` to cancel.",
                "You have 30 seconds."
            ].join("\n")
        );

        const filter = response => {
            return (
                response.author.id === message.author.id &&
                ["yes", "no"].includes(
                    response.content.toLowerCase()
                )
            );
        };

        const collected = await message.channel.awaitMessages({
            filter,
            max: 1,
            time: 30000
        });

        pendingConfirmations.delete(confirmationId);

        if (!collected.size) {
            await message.channel.send(
                "⌛ Clone cancelled because no confirmation was received."
            );

            return;
        }

        const response = collected.first();

        if (response.content.toLowerCase() === "no") {
            await message.channel.send(
                "❌ Clone cancelled."
            );

            return;
        }

        await message.channel.send(
            "🚀 Clone started. Check the bot console for progress."
        );

        try {
            await cloneServer(sourceGuild, targetGuild);

            await message.channel.send(
                `✅ **Clone completed**\n${sourceGuild.name} → ${targetGuild.name}`
            );
        } catch (error) {
            errorLog("Clone failed.", error);

            await message.channel.send(
                `❌ **Clone failed:** \`${error.message}\``
            );
        }
    } catch (error) {
        errorLog("Command error.", error);

        try {
            await message.reply(
                `❌ Error: \`${error.message}\``
            );
        } catch {}
    }
});

process.on("unhandledRejection", error => {
    errorLog("Unhandled promise rejection.", error);
});

process.on("uncaughtException", error => {
    errorLog("Uncaught exception.", error);
});

if (!process.env.TOKEN) {
    console.error("ERROR: TOKEN environment variable is missing.");
    process.exit(1);
}

client.login(process.env.TOKEN)
    .then(() => {
        log("Login request completed.");
    })
    .catch(error => {
        console.error("ERROR: Discord login failed.");
        console.error(error);
        process.exit(1);
    });
