require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionsBitField
} = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const allowedUsers = (process.env.ALLOWED_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

const pending = new Map();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function allowed(id) {
    return allowedUsers.includes(id);
}

async function cloneServer(source, target, channel) {
    await channel.send(`🗑️ Cleaning **${target.name}**...`);

    const channels = [...target.channels.cache.values()]
        .filter(c => c.deletable);

    for (const ch of channels) {
        try {
            await ch.delete();
            await sleep(150);
        } catch {}
    }

    const roles = [...target.roles.cache.values()]
        .filter(r =>
            r.name !== '@everyone' &&
            !r.managed &&
            r.editable
        );

    for (const role of roles) {
        try {
            await role.delete();
            await sleep(150);
        } catch {}
    }

    const roleMap = new Map();

    const sourceRoles = [...source.roles.cache.values()]
        .filter(r => r.name !== '@everyone')
        .sort((a, b) => a.position - b.position);

    for (const role of sourceRoles) {
        try {
            const newRole = await target.roles.create({
                name: role.name,
                color: role.hexColor,
                hoist: role.hoist,
                mentionable: role.mentionable,
                permissions: role.permissions.bitfield
            });

            roleMap.set(role.id, newRole.id);
            await sleep(200);
        } catch {}
    }

    const categories = [...source.channels.cache.values()]
        .filter(c => c.type === ChannelType.GuildCategory)
        .sort((a, b) => a.position - b.position);

    const categoryMap = new Map();

    for (const category of categories) {
        try {
            const created = await target.channels.create({
                name: category.name,
                type: ChannelType.GuildCategory
            });

            categoryMap.set(category.id, created.id);
            await sleep(200);
        } catch {}
    }

    const sourceChannels = [...source.channels.cache.values()]
        .filter(c =>
            c.type === ChannelType.GuildText ||
            c.type === ChannelType.GuildVoice ||
            c.type === ChannelType.GuildAnnouncement
        )
        .sort((a, b) => a.position - b.position);

    for (const ch of channels) {
        try {
            const options = {
                name: ch.name,
                type: ch.type
            };

            if (ch.parentId && categoryMap.has(ch.parentId)) {
                options.parent = categoryMap.get(ch.parentId);
            }

            if (ch.type === ChannelType.GuildText ||
                ch.type === ChannelType.GuildAnnouncement) {
                options.topic = ch.topic || undefined;
                options.nsfw = ch.nsfw;
                options.rateLimitPerUser = ch.rateLimitPerUser;
            }

            if (ch.type === ChannelType.GuildVoice) {
                options.bitrate = ch.bitrate;
                options.userLimit = ch.userLimit;
            }

            await target.channels.create(options);
            await sleep(250);
        } catch {}
    }

    try {
        await target.setName(source.name);

        if (source.iconURL()) {
            await target.setIcon(source.iconURL());
        }
    } catch {}

    await channel.send(`✅ Cloning completed: **${source.name} → ${target.name}**`);
}

client.once('ready', () => {
    console.log(`[+] Logged in as ${client.user.tag}`);
    console.log(`[+] Bot is online.`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (!allowed(message.author.id)) return;

    const content = message.content.trim();

    if (pending.has(message.author.id)) {
        const operation = pending.get(message.author.id);

        if (!['y', 'n', 'yes', 'no'].includes(content.toLowerCase())) {
            await message.reply('❌ Reply with `y` or `n`.');
            return;
        }

        if (content.toLowerCase() === 'n' ||
            content.toLowerCase() === 'no') {
            pending.delete(message.author.id);
            await message.reply('❌ Cancelled.');
            return;
        }

        pending.delete(message.author.id);

        const source = client.guilds.cache.get(operation.source);
        const target = client.guilds.cache.get(operation.target);

        if (!source || !target) {
            await message.reply('❌ Source or target server not found.');
            return;
        }

        await message.reply('🚀 Starting clone...');

        try {
            await cloneServer(source, target, message.channel);
        } catch (error) {
            console.error(error);
            await message.reply(`❌ Clone failed: ${error.message}`);
        }

        return;
    }

    if (!content.startsWith('!clone')) return;

    const args = content.split(/\s+/);

    if (args.length < 3) {
        await message.reply(
            '❌ Usage: `!clone SOURCE_SERVER_ID TARGET_SERVER_ID`'
        );
        return;
    }

    const sourceId = args[1];
    const targetId = args[2];

    const source = client.guilds.cache.get(sourceId);
    const target = client.guilds.cache.get(targetId);

    if (!source) {
        await message.reply('❌ I am not in the source server.');
        return;
    }

    if (!target) {
        await message.reply('❌ I am not in the target server.');
        return;
    }

    const me = target.members.me;

    if (!me.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
        !me.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
        !me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        await message.reply(
            '❌ I need Manage Channels, Manage Roles and Manage Guild in the target server.'
        );
        return;
    }

    pending.set(message.author.id, {
        source: sourceId,
        target: targetId
    });

    await message.reply(
        `⚠️ This will delete the existing channels and roles in **${target.name}**.\n` +
        `Reply with **y** to continue or **n** to cancel.`
    );
});

client.login(process.env.TOKEN).catch(error => {
    console.error('[-] Login failed:', error.message);
    process.exit(1);
});            });
            res.on('error', reject);
        }).on('error', reject);
    });
}

class ServerCloner {
    constructor(client) {
        this.client = client;
        this.roleMapping = new Map();
        this.stats = {
            rolesCreated: 0,
            categoriesCreated: 0,
            channelsCreated: 0,
            emojisCreated: 0,
            failed: 0
        };
    }

    async cloneServer(sourceGuildId, targetGuildId, cloneEmojis = true, progressChannel = null) {
        try {
            const sourceGuild = this.client.guilds.cache.get(sourceGuildId);
            const targetGuild = this.client.guilds.cache.get(targetGuildId);

            if (!sourceGuild) {
                throw new Error('Source server not found! Make sure you\'re a member.');
            }

            if (!targetGuild) {
                throw new Error('Target server not found! Make sure you\'re a member with admin permissions.');
            }

            this.sendProgress(`Cloning from: ${sourceGuild.name} -> ${targetGuild.name}`, progressChannel);
            this.sendProgress('Starting cloning process...', progressChannel);

           
            await this.deleteExistingContent(targetGuild, progressChannel);

           
            await this.cloneRoles(sourceGuild, targetGuild, progressChannel);
            await this.cloneCategories(sourceGuild, targetGuild, progressChannel);
            await this.cloneChannels(sourceGuild, targetGuild, progressChannel);
            
           
            if (cloneEmojis) {
                await this.cloneEmojis(sourceGuild, targetGuild, progressChannel);
            }
            
            await this.cloneServerInfo(sourceGuild, targetGuild, progressChannel);

            // Show final stats
            this.showStats(progressChannel);
            this.sendProgress('🎉 Server cloning completed successfully!', progressChannel);

        } catch (error) {
            this.sendProgress(`❌ Cloning failed: ${error.message}`, progressChannel);
            throw error;
        }
    }

    async deleteExistingContent(guild, progressChannel) {
        this.sendProgress('🗑️  Deleting existing content...', progressChannel);
        
       
        const channels = guild.channels.cache.filter(ch => ch.deletable);
        for (const [, channel] of channels) {
            try {
                await channel.delete();
                this.sendProgress(`Deleted channel: ${channel.name}`, progressChannel);
                await delay(100);
            } catch (error) {
                this.sendProgress(`Failed to delete channel ${channel.name}: ${error.message}`, progressChannel);
                this.stats.failed++;
            }
        }

       
        const roles = guild.roles.cache.filter(role => 
            role.name !== '@everyone' && 
            !role.managed && 
            role.editable
        );
        
        for (const [, role] of roles) {
            try {
                await role.delete();
                this.sendProgress(`Deleted role: ${role.name}`, progressChannel);
                await delay(100);
            } catch (error) {
                this.sendProgress(`Failed to delete role ${role.name}: ${error.message}`, progressChannel);
                this.stats.failed++;
            }
        }

        this.sendProgress('Cleanup completed.', progressChannel);
    }

    async cloneRoles(sourceGuild, targetGuild, progressChannel) {
        this.sendProgress('👑 Cloning roles...', progressChannel);
        
        const roles = sourceGuild.roles.cache
            .filter(role => role.name !== '@everyone')
            .sort((a, b) => a.position - b.position);

        for (const [, role] of roles) {
            try {
                const newRole = await targetGuild.roles.create({
                    name: role.name,
                    color: role.hexColor,
                    permissions: role.permissions,
                    hoist: role.hoist,
                    mentionable: role.mentionable,
                    reason: 'Server cloning'
                });

                this.roleMapping.set(role.id, newRole.id);
                this.sendProgress(`Created role: ${role.name}`, progressChannel);
                this.stats.rolesCreated++;
                await delay(200);

            } catch (error) {
                this.sendProgress(`Failed to create role ${role.name}: ${error.message}`, progressChannel);
                this.stats.failed++;
            }
        }

     
        await this.fixRolePositions(sourceGuild, targetGuild, progressChannel);
        this.sendProgress('Roles cloning completed.', progressChannel);
    }

    async fixRolePositions(sourceGuild, targetGuild, progressChannel) {
        try {
            const sourceRoles = sourceGuild.roles.cache
                .filter(role => role.name !== '@everyone')
                .sort((a, b) => b.position - a.position);

            for (const [, sourceRole] of sourceRoles) {
                const targetRole = targetGuild.roles.cache.find(r => r.name === sourceRole.name);
                if (targetRole && targetRole.editable) {
                    try {
                        await targetRole.setPosition(sourceRole.position);
                        await delay(100);
                    } catch (error) {
                        
                    }
                }
            }
        } catch (error) {
            this.sendProgress('Could not fix all role positions', progressChannel);
        }
    }

    async cloneCategories(sourceGuild, targetGuild, progressChannel) {
        this.sendProgress('📁 Cloning categories...', progressChannel);
        
        const categories = sourceGuild.channels.cache
            .filter(ch => ch.type === 'GUILD_CATEGORY')
            .sort((a, b) => a.position - b.position);

        for (const [, category] of categories) {
            try {
                const overwrites = this.mapPermissionOverwrites(category.permissionOverwrites, targetGuild);
                
                const newCategory = await targetGuild.channels.create(category.name, {
                    type: 'GUILD_CATEGORY',
                    permissionOverwrites: overwrites || [],
                    position: category.position,
                    reason: 'Server cloning'
                });

                this.sendProgress(`Created category: ${category.name}`, progressChannel);
                this.stats.categoriesCreated++;
                await delay(200);

            } catch (error) {
                this.sendProgress(`Failed to create category ${category.name}: ${error.message}`, progressChannel);
                this.stats.failed++;
            }
        }

        this.sendProgress('Categories cloning completed.', progressChannel);
    }

    async cloneChannels(sourceGuild, targetGuild, progressChannel) {
        this.sendProgress('💬 Cloning channels...', progressChannel);
        
        const channels = sourceGuild.channels.cache
            .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 'GUILD_VOICE')
            .sort((a, b) => a.position - b.position);

        for (const [, channel] of channels) {
            try {
                const overwrites = this.mapPermissionOverwrites(channel.permissionOverwrites, targetGuild);
                const parent = channel.parent ? 
                    targetGuild.channels.cache.find(c => c.name === channel.parent.name && c.type === 'GUILD_CATEGORY') : 
                    null;

                const channelOptions = {
                    type: channel.type,
                    parent: parent?.id,
                    permissionOverwrites: overwrites || [],
                    position: channel.position,
                    reason: 'Server cloning'
                };

              
                if (channel.type === 'GUILD_TEXT') {
                    channelOptions.topic = channel.topic || '';
                    channelOptions.nsfw = channel.nsfw;
                    channelOptions.rateLimitPerUser = channel.rateLimitPerUser;
                } else if (channel.type === 'GUILD_VOICE') {
                    channelOptions.bitrate = channel.bitrate;
                    channelOptions.userLimit = channel.userLimit;
                }

                const newChannel = await targetGuild.channels.create(channel.name, channelOptions);
                
                const channelType = channel.type === 'GUILD_TEXT' ? 'text' : 'voice';
                this.sendProgress(`Created ${channelType} channel: ${channel.name}`, progressChannel);
                this.stats.channelsCreated++;
                await delay(200);

            } catch (error) {
                this.sendProgress(`Failed to create channel ${channel.name}: ${error.message}`, progressChannel);
                this.stats.failed++;
            }
        }

        this.sendProgress('Channels cloning completed.', progressChannel);
    }

    async cloneEmojis(sourceGuild, targetGuild, progressChannel) {
        this.sendProgress('😀 Cloning emojis...', progressChannel);
        
        const emojis = sourceGuild.emojis.cache;
        
        for (const [, emoji] of emojis) {
            try {
                const emojiURL = emoji.url;
                const imageData = await downloadImage(emojiURL);

                await targetGuild.emojis.create(imageData, emoji.name, {
                    reason: 'Server cloning'
                });

                this.sendProgress(`Created emoji: ${emoji.name}`, progressChannel);
                this.stats.emojisCreated++;
            
                await delay(2000);

            } catch (error) {
                this.sendProgress(`Failed to create emoji ${emoji.name}: ${error.message}`, progressChannel);
                this.stats.failed++;
            }
        }

        this.sendProgress('Emojis cloning completed.', progressChannel);
    }

    async cloneServerInfo(sourceGuild, targetGuild, progressChannel) {
        this.sendProgress('🏠 Cloning server info...', progressChannel);
        
        try {
            let iconData = null;
            
            if (sourceGuild.iconURL()) {
                try {
                    iconData = await downloadImage(sourceGuild.iconURL({ format: 'png', size: 1024 }));
                } catch (error) {
                    this.sendProgress('Could not download server icon', progressChannel);
                }
            }

            await targetGuild.setName(sourceGuild.name);
            this.sendProgress(`Updated server name: ${sourceGuild.name}`, progressChannel);

            if (iconData) {
                await targetGuild.setIcon(iconData);
                this.sendProgress('Updated server icon', progressChannel);
            }

        } catch (error) {
            this.sendProgress(`Failed to update server info: ${error.message}`, progressChannel);
            this.stats.failed++;
        }

        this.sendProgress('Server info cloning completed.', progressChannel);
    }

    mapPermissionOverwrites(overwrites, targetGuild) {
        const mappedOverwrites = [];

        if (!overwrites || !overwrites.cache) {
            return mappedOverwrites;
        }

        overwrites.cache.forEach((overwrite) => {
            try {
                let targetId = overwrite.id;

                
                if (overwrite.type === 'role') {
                    const newRoleId = this.roleMapping.get(overwrite.id);
                    if (newRoleId) {
                        targetId = newRoleId;
                    } else {
                        
                        const targetRole = targetGuild.roles.cache.find(r => {
                            const sourceGuild = overwrites.constructor.name === 'PermissionOverwriteManager' ? overwrites.channel.guild : null;
                            if (sourceGuild) {
                                const sourceRole = sourceGuild.roles.cache.get(overwrite.id);
                                return sourceRole && r.name === sourceRole.name;
                            }
                            return false;
                        });
                        if (targetRole) {
                            targetId = targetRole.id;
                        } else {
                            return;
                        }
                    }
                }

                if (overwrite.allow !== undefined && overwrite.deny !== undefined) {
                    mappedOverwrites.push({
                        id: targetId,
                        type: overwrite.type,
                        allow: overwrite.allow,
                        deny: overwrite.deny
                    });
                }
            } catch (error) {
                this.sendProgress(`Skipped permission overwrite due to error: ${error.message}`);
            }
        });

        return mappedOverwrites;
    }

    showStats(progressChannel) {
        const total = this.stats.rolesCreated + this.stats.categoriesCreated + 
                     this.stats.channelsCreated + this.stats.emojisCreated;
        const successRate = Math.round((total/(total + this.stats.failed)) * 100) || 0;
        
        const statsMessage = `
📊 **Cloning Statistics:**
✅ Roles Created: ${this.stats.rolesCreated}
✅ Categories Created: ${this.stats.categoriesCreated}
✅ Channels Created: ${this.stats.channelsCreated}
✅ Emojis Created: ${this.stats.emojisCreated}
❌ Failed Operations: ${this.stats.failed}
📈 Success Rate: ${successRate}%`;
        
        this.sendProgress(statsMessage, progressChannel);
    }
    
    sendProgress(message, progressChannel) {
        if (progressChannel) {
            if (message.length > 2000) {
                const chunks = message.match(/.{1,2000}/g);
                chunks.forEach(chunk => {
                    progressChannel.send(chunk).then(sentMsg => {
                        botMessageIds.add(sentMsg.id);
                        if (botMessageIds.size > 50) {
                            const firstId = botMessageIds.values().next().value;
                            botMessageIds.delete(firstId);
                        }
                    }).catch(() => {});
                });
            } else {
                progressChannel.send(message).then(sentMsg => {
                    botMessageIds.add(sentMsg.id);
                    if (botMessageIds.size > 50) {
                        const firstId = botMessageIds.values().next().value;
                        botMessageIds.delete(firstId);
                    }
                }).catch(() => {});
            }
        }
        
        if (message.includes('❌') || message.includes('[-]')) {
            log.error(message.replace(/❌|✅|📊|📈|🗑️|👑|📁|💬|😀|🏠|🎉/g, '').trim());
        } else if (message.includes('✅') || message.includes('[+]')) {
            log.success(message.replace(/❌|✅|📊|📈|🗑️|👑|📁|💬|😀|🏠|🎉/g, '').trim());
        } else if (message.includes('📊') || message.includes('📈') || message.includes('[i]')) {
            log.info(message.replace(/❌|✅|📊|📈|🗑️|👑|📁|💬|😀|🏠|🎉/g, '').trim());
        } else {
            console.log(message);
        }
    }
}

const pendingOperations = new Map();

const client = new Client();

const botMessageIds = new Set();

client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id && botMessageIds.has(message.id)) {
        return;
    }
    
    if (message.author.bot && message.author.id !== client.user.id) return;
    
    const isDM = message.channel.type === 'DM';
    
    const allowedUserIds = process.env.ALLOWED_USER_IDS?.split(',').map(id => id.trim()) || [];
    const isAllowedUser = allowedUserIds.includes(message.author.id);
    
    if (pendingOperations.has(message.author.id)) {
        const operation = pendingOperations.get(message.author.id);
        
        if (!isAllowedUser) {
            return;
        }
        
        const messageContent = message.content.toLowerCase().trim();
        
        if (message.content.length > 10) {
            return;
        }
        
        const validResponses = ['y', 'n', 'yes', 'no'];
        if (!validResponses.includes(messageContent)) {
            if (message.content.length <= 5) {
                message.channel.send('❌ Please respond with "y" or "n"').then(sentMsg => {
                    botMessageIds.add(sentMsg.id);
                }).catch(() => {});
            }
            return;
        }
        
        if (operation.step === 'confirmProceed') {
            if (messageContent === 'y' || messageContent === 'yes') {
                message.channel.send('❓ Do you want to clone emojis too? (y/n)').then(sentMsg => {
                    botMessageIds.add(sentMsg.id);
                }).catch(() => {});
                operation.step = 'confirmEmojis';
                return;
            } else if (messageContent === 'n' || messageContent === 'no') {
                message.channel.send('❌ Operation cancelled.').then(sentMsg => {
                    botMessageIds.add(sentMsg.id);
                }).catch(() => {});
                pendingOperations.delete(message.author.id);
                return;
            }
        } else if (operation.step === 'confirmEmojis') {
            if (messageContent === 'y' || messageContent === 'yes') {
                operation.cloneEmojis = true;
                pendingOperations.delete(message.author.id);
                message.channel.send('🚀 Starting server cloning process...').then(sentMsg => {
                    botMessageIds.add(sentMsg.id);
                }).catch(() => {});
                try {
                    const cloner = new ServerCloner(client);
                    await cloner.cloneServer(operation.sourceGuildId, operation.targetGuildId, operation.cloneEmojis, message.channel);
                } catch (error) {
                    message.channel.send(`❌ Error during cloning: ${error.message}`).then(sentMsg => {
                        botMessageIds.add(sentMsg.id);
                    }).catch(() => {});
                }
                return;
            } else if (messageContent === 'n' || messageContent === 'no') {
                operation.cloneEmojis = false;
                pendingOperations.delete(message.author.id);
                message.channel.send('🚀 Starting server cloning process (without emojis)...').then(sentMsg => {
                    botMessageIds.add(sentMsg.id);
                }).catch(() => {});
                try {
                    const cloner = new ServerCloner(client);
                    await cloner.cloneServer(operation.sourceGuildId, operation.targetGuildId, operation.cloneEmojis, message.channel);
                } catch (error) {
                    message.channel.send(`❌ Error during cloning: ${error.message}`).then(sentMsg => {
                        botMessageIds.add(sentMsg.id);
                    }).catch(() => {});
                }
                return;
            }
        }
    }
    
    if (message.content.startsWith('!clone')) {
        if (!isAllowedUser) {
            return;
        }
        
        const args = message.content.slice(6).trim().split(/ +/);
        const sourceGuildId = args[0];
        const targetGuildId = args[1];
        
        if (!sourceGuildId || !targetGuildId) {
            message.channel.send('❌ Usage: `!clone <source server ID> <target server ID>`').then(sentMsg => {
                botMessageIds.add(sentMsg.id);
            }).catch(() => {});
            return;
        }
        
        try {
    
            const sourceGuild = client.guilds.cache.get(sourceGuildId);
            const targetGuild = client.guilds.cache.get(targetGuildId);
            
            if (!sourceGuild) {
                message.channel.send('Source server not found! Make sure you\'re a member.').then(sentMsg => {
                    botMessageIds.add(sentMsg.id);
                }).catch(() => {});
                return;
            }
            
            if (!targetGuild) {
                message.channel.send('Target server not found! Make sure you\'re a member with admin permissions.').then(sentMsg => {
                    botMessageIds.add(sentMsg.id);
                }).catch(() => {});
                return;
            }
            
            pendingOperations.set(message.author.id, {
                step: 'confirmProceed',
                sourceGuildId,
                targetGuildId,
                sourceGuildName: sourceGuild.name,
                targetGuildName: targetGuild.name,
                cloneEmojis: true
            });
            
            message.channel.send(`📋 **Server Cloning Confirmation**
Source Server: **${sourceGuild.name}**
Target Server: **${targetGuild.name}**

Do you want to proceed? (y/n)`).then(sentMsg => {
                botMessageIds.add(sentMsg.id);
            }).catch(() => {});
        } catch (error) {
            message.channel.send(`❌ Error: ${error.message}`).then(sentMsg => {
                botMessageIds.add(sentMsg.id);
            }).catch(() => {});
        }
    }
});

process.on('SIGINT', () => {
    log.warning('\nProcess interrupted by user');
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    log.error(`Unhandled rejection: ${error.message}`);
});

process.on('uncaughtException', (error) => {
    log.error(`Uncaught exception: ${error.message}`);
});

client.login(process.env.TOKEN).then(() => {
    log.success('Logged in successfully!');
}).catch((error) => {
    log.error(`Login failed: ${error.message}`);
    process.exit(1);
});

module.exports = { ServerCloner };
