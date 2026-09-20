require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    ChannelType
} = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = "!";
const TOKEN = process.env.TOKEN;

const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(id => id.length > 0);

function isAllowed(userId) {
    return ALLOWED_USER_IDS.includes(userId);
}

function log(message) {
    console.log("[ServerCloner] " + message);
}

async function deleteTargetChannels(guild) {
    const channelsToDelete = [...guild.channels.cache.values()];

    for (const channel of channelsToDelete) {
        try {
            await channel.delete("Server clone");
            log("Deleted channel: " + channel.name);
        } catch (error) {
            console.error(
                "Failed to delete channel " +
                channel.name +
                ": " +
                error.message
            );
        }
    }
}

async function deleteTargetRoles(guild) {
    const rolesToDelete = [...guild.roles.cache.values()]
        .filter(role => !role.managed && role.id !== guild.id);

    for (const role of rolesToDelete) {
        try {
            await role.delete("Server clone");
            log("Deleted role: " + role.name);
        } catch (error) {
            console.error(
                "Failed to delete role " +
                role.name +
                ": " +
                error.message
            );
        }
    }
}

async function cloneRoles(source, target) {
    const roleMap = new Map();

    const sourceRoles = [...source.roles.cache.values()]
        .filter(role => !role.managed && role.id !== source.id)
        .sort((a, b) => a.position - b.position);

    for (const sourceRole of sourceRoles) {
        try {
            const newRole = await target.roles.create({
                name: sourceRole.name,
                color: sourceRole.color,
                hoist: sourceRole.hoist,
                mentionable: sourceRole.mentionable,
                permissions: sourceRole.permissions.bitfield,
                reason: "Server clone"
            });

            roleMap.set(sourceRole.id, newRole.id);

            log("Created role: " + sourceRole.name);
        } catch (error) {
            console.error(
                "Failed to create role " +
                sourceRole.name +
                ": " +
                error.message
            );
        }
    }

    return roleMap;
}

async function cloneCategories(source, target) {
    const categoryMap = new Map();

    const sourceCategories = [...source.channels.cache.values()]
        .filter(channel => channel.type === ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);

    for (const category of sourceCategories) {
        try {
            const newCategory = await target.channels.create({
                name: category.name,
                type: ChannelType.GuildCategory,
                reason: "Server clone"
            });

            categoryMap.set(category.id, newCategory.id);

            log("Created category: " + category.name);
        } catch (error) {
            console.error(
                "Failed to create category " +
                category.name +
                ": " +
                error.message
            );
        }
    }

    return categoryMap;
}

function getSupportedChannelType(channel) {
    if (channel.type === ChannelType.GuildText) {
        return ChannelType.GuildText;
    }

    if (channel.type === ChannelType.GuildVoice) {
        return ChannelType.GuildVoice;
    }

    if (channel.type === ChannelType.GuildAnnouncement) {
        return ChannelType.GuildAnnouncement;
    }

    if (channel.type === ChannelType.GuildStageVoice) {
        return ChannelType.GuildStageVoice;
    }

    if (channel.type === ChannelType.GuildForum) {
        return ChannelType.GuildForum;
    }

    return null;
}

async function cloneChannels(source, target, categoryMap) {
    const sourceChannels = [...source.channels.cache.values()]
        .filter(channel => channel.type !== ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);

    for (const sourceChannel of sourceChannels) {
        const channelType = getSupportedChannelType(sourceChannel);

        if (!channelType) {
            log(
                "Skipped unsupported channel: " +
                sourceChannel.name
            );

            continue;
        }

        try {
            const options = {
                name: sourceChannel.name,
                type: channelType,
                reason: "Server clone"
            };

            if (sourceChannel.parentId) {
                const categoryId = categoryMap.get(
                    sourceChannel.parentId
                );

                if (categoryId) {
                    options.parent = categoryId;
                }
            }

            if (
                channelType === ChannelType.GuildText ||
                channelType === ChannelType.GuildAnnouncement
            ) {
                options.nsfw = sourceChannel.nsfw || false;

                if (sourceChannel.topic) {
                    options.topic = sourceChannel.topic;
                }

                if (sourceChannel.rateLimitPerUser) {
                    options.rateLimitPerUser =
                        sourceChannel.rateLimitPerUser;
                }
            }

            if (
                channelType === ChannelType.GuildVoice ||
                channelType === ChannelType.GuildStageVoice
            ) {
                if (sourceChannel.bitrate) {
                    options.bitrate = sourceChannel.bitrate;
                }

                if (sourceChannel.userLimit) {
                    options.userLimit = sourceChannel.userLimit;
                }
            }

            await target.channels.create(options);

            log("Created channel: " + sourceChannel.name);
        } catch (error) {
            console.error(
                "Failed to create channel " +
                sourceChannel.name +
                ": " +
                error.message
            );
        }
    }
}

async function cloneEmojis(source, target) {
    const sourceEmojis = [...source.emojis.cache.values()];

    if (sourceEmojis.length === 0) {
        log("No emojis found.");
        return;
    }

    for (const emoji of sourceEmojis) {
        try {
            if (!emoji.url) {
                continue;
            }

            await target.emojis.create({
                attachment: emoji.url,
                name: emoji.name,
                reason: "Server clone"
            });

            log("Created emoji: " + emoji.name);
        } catch (error) {
            console.error(
                "Failed to create emoji " +
                emoji.name +
                ": " +
                error.message
            );
        }
    }
}

async function cloneServer(source, target) {
    log("========================================");
    log("Starting server clone");
    log("Source: " + source.name);
    log("Target: " + target.name);
    log("========================================");

    await source.channels.fetch();
    await target.channels.fetch();

    await source.roles.fetch();
    await target.roles.fetch();

    log("Step 1/5 - Clearing target channels...");
    await deleteTargetChannels(target);

    log("Step 2/5 - Clearing target roles...");
    await deleteTargetRoles(target);

    log("Step 3/5 - Cloning roles...");
    const roleMap = await cloneRoles(source, target);

    log("Step 4/5 - Cloning categories and channels...");
    const categoryMap = await cloneCategories(source, target);

    await cloneChannels(
        source,
        target,
        categoryMap,
        roleMap
    );

    log("Step 5/5 - Cloning emojis...");
    await cloneEmojis(source, target);

    log("========================================");
    log("Server clone completed");
    log("========================================");
}

client.once("ready", () => {
    console.log("");
    console.log("========================================");
    console.log("       DISCORD SERVER CLONER");
    console.log("========================================");
    console.log("");
    console.log("Logged in as: " + client.user.tag);
    console.log("Bot ID: " + client.user.id);
    console.log(
        "Connected servers: " +
        client.guilds.cache.size
    );
    console.log("");
    console.log("Bot is ready.");
    console.log("Listening for clone commands.");
    console.log("");
});

client.on("messageCreate", async message => {
    if (message.author.bot) {
        return;
    }

    if (!message.content.startsWith(PREFIX)) {
        return;
    }

    const args = message.content
        .trim()
        .split(/\s+/);

    const command = args[0]
        .slice(PREFIX.length)
        .toLowerCase();

    if (command === "help") {
        await message.reply(
            [
                "**Discord Server Cloner**",
                "",
                "`!clone <source ID> <target ID>`",
                "Clone the structure of one server into another.",
                "",
                "`!guilds`",
                "Show servers accessible by the bot.",
                "",
                "`!status`",
                "Show bot status."
            ].join("\n")
        );

        return;
    }

    if (command === "status") {
        await message.reply(
            "🟢 Bot online\n" +
            "Connected servers: " +
            client.guilds.cache.size
        );

        return;
    }

    if (command === "guilds") {
        if (!isAllowed(message.author.id)) {
            await message.reply(
                "❌ You are not authorized to use this command."
            );

            return;
        }

        const guildList = [...client.guilds.cache.values()]
            .map(
                guild =>
                    "• " +
                    guild.name +
                    " — `" +
                    guild.id +
                    "`"
            )
            .join("\n");

        if (!guildList) {
            await message.reply(
                "The bot is not connected to any servers."
            );

            return;
        }

        await message.reply(
            "**Connected Servers**\n" +
            guildList
        );

        return;
    }

    if (command !== "clone") {
        return;
    }

    if (!isAllowed(message.author.id)) {
        await message.reply(
            "❌ You are not authorized to use this command."
        );

        return;
    }

    if (args.length < 3) {
        await message.reply(
            "Usage:\n" +
            "`!clone <sourceGuildId> <targetGuildId>`"
        );

        return;
    }

    const sourceId = args[1];
    const targetId = args[2];

    if (!/^\d{17,20}$/.test(sourceId)) {
        await message.reply(
            "❌ Invalid source server ID."
        );

        return;
    }

    if (!/^\d{17,20}$/.test(targetId)) {
        await message.reply(
            "❌ Invalid target server ID."
        );

        return;
    }

    if (sourceId === targetId) {
        await message.reply(
            "❌ Source and target servers cannot be the same."
        );

        return;
    }

    let source;
    let target;

    try {
        source = await client.guilds.fetch(sourceId);
    } catch (error) {
        await message.reply(
            "❌ I cannot access the source server."
        );

        return;
    }

    try {
        target = await client.guilds.fetch(targetId);
    } catch (error) {
        await message.reply(
            "❌ I cannot access the target server."
        );

        return;
    }

    await message.reply(
        [
            "⚠️ **Clone Confirmation**",
            "",
            "**Source:** " + source.name,
            "**Target:** " + target.name,
            "",
            "This will modify the target server.",
            "",
            "Type `yes` to continue.",
            "Type `no` to cancel.",
            "",
            "You have 30 seconds."
        ].join("\n")
    );

    const filter = response => {
        return (
            response.author.id === message.author.id &&
            (
                response.content.toLowerCase() === "yes" ||
                response.content.toLowerCase() === "no"
            )
        );
    };

    let collected;

    try {
        collected = await message.channel.awaitMessages({
            filter,
            max: 1,
            time: 30000
        });
    } catch (error) {
        await message.channel.send(
            "❌ Failed to receive confirmation."
        );

        return;
    }

    if (collected.size === 0) {
        await message.channel.send(
            "⌛ Clone cancelled. No confirmation received."
        );

        return;
    }

    const confirmation =
        collected.first().content.toLowerCase();

    if (confirmation === "no") {
        await message.channel.send(
            "❌ Clone cancelled."
        );

        return;
    }

    await message.channel.send(
        "🚀 **Clone started.**\n" +
        "The bot is now cloning the server."
    );

    try {
        await cloneServer(source, target);

        await message.channel.send(
            "✅ **Clone completed successfully.**\n" +
            source.name +
            " → " +
            target.name
        );
    } catch (error) {
        console.error(
            "Clone failed:",
            error
        );

        await message.channel.send(
            "❌ **Clone failed:** `" +
            error.message +
            "`"
        );
    }
});

client.on("error", error => {
    console.error(
        "Discord client error:",
        error
    );
});

process.on("unhandledRejection", error => {
    console.error(
        "Unhandled promise rejection:",
        error
    );
});

process.on("uncaughtException", error => {
    console.error(
        "Uncaught exception:",
        error
    );
});

if (!TOKEN) {
    console.error(
        "ERROR: The TOKEN environment variable is missing."
    );

    process.exit(1);
}

client.login(TOKEN)
    .then(() => {
        console.log("Discord login successful.");
    })
    .catch(error => {
        console.error(
            "Discord login failed:"
        );

        console.error(error);

        process.exit(1);
    });
