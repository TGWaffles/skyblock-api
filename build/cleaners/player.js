"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanPlayerResponse = void 0;
const hypixel_1 = require("../hypixel");
const socialmedia_1 = require("./socialmedia");
const rank_1 = require("./rank");
const util_1 = require("../util");
async function cleanPlayerResponse(data) {
    // Cleans up a 'player' api response
    console.log('cleanPlayerResponse', data.stats.SkyBlock.profiles);
    return {
        uuid: util_1.undashUuid(data.uuid),
        username: data.displayname,
        rank: rank_1.parseRank(data),
        socials: socialmedia_1.parseSocialMedia(data.socialMedia),
        profiles: hypixel_1.cleanPlayerSkyblockProfiles(data.stats.SkyBlock.profiles)
    };
}
exports.cleanPlayerResponse = cleanPlayerResponse;
