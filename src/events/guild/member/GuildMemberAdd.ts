import { EmbedBuilder, Events, GuildMember, GuildTextBasedChannel } from "discord.js";
import i18next from "i18next";

import Listener from "../../Listener.js";
import { ContextGuildMember } from "../../../types/index.js";

class GuildMemberAdd extends Listener {
  public constructor() {
    super(Events.GuildMemberAdd);
  }

  public override async execute(member: GuildMember) {
    const { database, config } = this.client;

    const context = await this.getContext(member.guild.id);

    if (member.user.bot) {
      await context.send?.({
        embeds: [
          new EmbedBuilder()
            .setTitle(i18next.t(`events.${this.name}.messages.bot.title`, { lng: context.language }))
            .setDescription(
              i18next.t(`events.${this.name}.messages.bot.description`, {
                lng: context.language,
                member: member.user.id,
                createdAt: Math.floor(member.user.createdTimestamp / 1000),
              })
            )
            .setColor(config.message.colors.warn)
            .setThumbnail(member.displayAvatarURL({ forceStatic: true }))
            .withDefaultFooter(),
        ],
      });

      return;
    }

    const previousInvites = this.client.invites.get(member.guild.id)!;
    const currentGuildInvites = await member.guild.invites.fetch();

    let code: string | undefined;
    let usedInvite = previousInvites
      .filter((_, key) => key !== member.guild.id)
      .find((previousInvite, key) => {
        code = key;
        return currentGuildInvites.get(key)!.uses! > previousInvite.uses!;
      });

    if (!usedInvite && member.guild.vanityURLCode) {
      if (previousInvites.get(member.guild.vanityURLCode)!.uses > member.guild.vanityURLUses!) {
        usedInvite = previousInvites.get(member.guild.vanityURLCode)!;
        code = member.guild.vanityURLCode;
      }
    }

    if (code && usedInvite) {
      this.client.invites
        .get(member.guild.id)!
        .set(code, { member: usedInvite!.member, uses: usedInvite!.uses + 1, source: usedInvite?.source });
    }

    if (context.firstJoin) {
      const data = await database
        .query(
          "SELECT inviter_id AS inviter FROM invites WHERE guild_id = ? AND member_id = ? AND inactive = true ORDER BY created_at DESC LIMIT 1",
          [member.guild.id, member.user.id]
        )
        .catch(() => void 0);

      if (data && data.length !== 0) {
        const [row] = data;

        if (context.originalInviter && row.inviter) {
          await database.query("UPDATE invites SET inactive = false WHERE guild_id = ? AND member_id = ? AND inviter_id = ?", [
            member.guild.id,
            member.user.id,
            row.inviter,
          ]);
        }

        if (row.inviter === member.guild.id) {
          await context.send?.({
            embeds: [
              new EmbedBuilder()
                .setTitle(i18next.t(`events.${this.name}.messages.first_vanity.title`, { lng: context.language }))
                .setDescription(
                  i18next.t(`events.${this.name}.messages.first_vanity.description`, {
                    lng: context.language,
                    member: member.user.id,
                    createdAt: Math.floor(member.user.createdTimestamp / 1000),
                  })
                )
                .setColor(config.message.colors.success)
                .setThumbnail(member.displayAvatarURL({ forceStatic: true }))
                .withDefaultFooter(),
            ],
          });
        } else {
          await context.send?.({
            embeds: [
              new EmbedBuilder()
                .setTitle(i18next.t(`events.${this.name}.messages.first.title`, { lng: context.language }))
                .setDescription(
                  i18next.t(`events.${this.name}.messages.first.description`, {
                    lng: context.language,
                    member: member.user.id,
                    code,
                    createdAt: Math.floor(member.user.createdTimestamp / 1000),
                  })
                )
                .setColor(config.message.colors.success)
                .withDefaultFooter(),
            ],
          });
        }

        return;
      }
    }

    if (!code || !usedInvite) {
      await context.send?.({
        embeds: [
          new EmbedBuilder()
            .setTitle(i18next.t(`events.${this.name}.messages.invalid.title`, { lng: context.language }))
            .setDescription(
              i18next.t(`events.${this.name}.messages.invalid.description`, {
                lng: context.language,
                member: member.user.id,
                createdAt: Math.floor(member.user.createdTimestamp / 1000),
              })
            )
            .setColor(config.message.colors.warn)
            .setThumbnail(member.displayAvatarURL({ forceStatic: true }))
            .withDefaultFooter(),
        ],
      });

      return;
    }

    let fake = false;

    if (context.older && Date.now() - member.user.createdTimestamp < 1000 * 60 * 60 * 24 * context.older) {
      fake = true;
    }

    if (context.ownInvite && usedInvite.member === member.user.id) {
      fake = true;
    }

    if (context.profilePic && !member.user.avatar) {
      fake = true;
    }

    const inviter = member.guild.members.cache.get(usedInvite.member) || (await member.guild.members.fetch(usedInvite.member));

    if (context.role) {
      if (inviter.roles.cache.has(context.role)) {
        fake = true;
      }
    }

    await database
      .query("INSERT INTO invites (guild_id, inviter_id, member_id, code, fake) VALUES (?, ?, ?, ?, ?)", [
        member.guild.id,
        usedInvite.member,
        member.user.id,
        code,
        fake,
      ])
      .catch(() => void 0);

    const invites =
      (
        await database
          .query(
            "SELECT COUNT(inviter_id) AS invites FROM invites WHERE guild_id = ? AND inviter_id = ? AND inactive = false AND fake = false",
            [member.guild.id, usedInvite.member]
          )
          .catch(() => void 0)
      )?.[0].invites || 0;

    await this.updateRole(member.guild.id, inviter, invites);

    if (usedInvite.source) {
      await context.send?.({
        embeds: [
          new EmbedBuilder()
            .setTitle(i18next.t(`events.${this.name}.messages.valid_source.title`, { lng: context.language }))
            .setDescription(
              i18next.t(`events.${this.name}.messages.valid_source.description`, {
                lng: context.language,
                member: member.user.id,
                inviter: usedInvite.member,
                invites,
                source: usedInvite.source,
                createdAt: Math.floor(member.user.createdTimestamp / 1000),
              })
            )
            .setColor(config.message.colors.success)
            .setThumbnail(member.displayAvatarURL({ forceStatic: true }))
            .withDefaultFooter(),
        ],
      });
    } else {
      await context.send?.({
        embeds: [
          new EmbedBuilder()
            .setTitle(i18next.t(`events.${this.name}.messages.valid.title`, { lng: context.language }))
            .setDescription(
              i18next.t(`events.${this.name}.messages.valid.description`, {
                lng: context.language,
                member: member.user.id,
                inviter: usedInvite.member,
                invites,
                code,
                createdAt: Math.floor(member.user.createdTimestamp / 1000),
              })
            )
            .setColor(config.message.colors.success)
            .setThumbnail(member.displayAvatarURL({ forceStatic: true }))
            .withDefaultFooter(),
        ],
      });
    }
  }

  private async getContext(guildId: string): Promise<ContextGuildMember> {
    const { database } = this.client;

    const data = await database
      .query(
        "SELECT G.language AS language, C.channel_id AS send, F.role_id AS role, F.own_invite AS ownInvite, F.older AS older, F.custom_profile_pic AS profilePic, F.first_join AS firstJoin, F.back_original_inviter AS originalInviter FROM guilds G LEFT JOIN channels C ON G.guild_id = C.guild_id AND C.channel_type = 'welcome' AND C.active = true LEFT JOIN fakes F ON F.guild_id = G.guild_id WHERE G.guild_id = ?",
        [guildId]
      )
      .catch(() => void 0);

    if (!data || data.length === 0) {
      return {};
    }

    const [row] = data;

    if (row.send) {
      const channel = (await this.client.channels.fetch(row.send, { cache: true }).catch(() => {
        database.query("DELETE FROM channels WHERE channel_id = ?", [row.send]);
      })) as GuildTextBasedChannel;

      if (channel) {
        row.send = channel.send.bind(channel);
      }
    }

    return row;
  }

  private async updateRole(guildId: string, inviter: GuildMember, invites: number) {
    const { database } = this.client;

    const data = await database
      .query(
        "SELECT role_id AS role, number_invitations AS requiredInvitations FROM roles WHERE guild_id = ? AND active = true GROUP BY role",
        [guildId]
      )
      .catch(() => void 0);

    if (!data || data.length === 0) {
      return;
    }

    data
      .filter(({ role, requiredInvitations }) => {
        const hasRoleAlready = inviter.roles.cache.some((roleCache) => roleCache.id === role);
        const hasEnoughInvites = invites >= requiredInvitations;
        return !hasRoleAlready && hasEnoughInvites;
      })
      .forEach(async ({ role }) => await inviter.roles.add(role).catch(() => void 0));
  }
}

export default GuildMemberAdd;
