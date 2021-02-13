"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMemberProfile = exports.fetchUser = exports.cleanPlayerSkyblockProfiles = exports.sendCleanApiRequest = exports.maxMinion = exports.saveInterval = void 0;
const minions_1 = require("./cleaners/skyblock/minions");
const stats_1 = require("./cleaners/skyblock/stats");
const player_1 = require("./cleaners/player");
const hypixelApi_1 = require("./hypixelApi");
const cached = __importStar(require("./hypixelCached"));
// the interval at which the "last_save" parameter updates in the hypixel api, this is 3 minutes
exports.saveInterval = 60 * 3 * 1000;
// the highest level a minion can be
exports.maxMinion = 11;
/**
 *  Send a request to api.hypixel.net using a random key, clean it up to be more useable, and return it
 */
async function sendCleanApiRequest({ path, args }, included, cleaned = true) {
    const key = await hypixelApi_1.chooseApiKey();
    const rawResponse = await hypixelApi_1.sendApiRequest({ path, key, args });
    if (rawResponse.throttled) {
        // if it's throttled, wait a second and try again
        console.log('throttled :/');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await sendCleanApiRequest({ path, args }, included, cleaned);
    }
    if (cleaned) {
        // if it needs to clean the response, call cleanResponse
        return await cleanResponse({ path, data: rawResponse }, included = included);
    }
    else {
        // this is provided in case the caller wants to do the cleaning itself
        // used in skyblock/profile, as cleaning the entire profile would use too much cpu
        return rawResponse;
    }
}
exports.sendCleanApiRequest = sendCleanApiRequest;
async function cleanSkyBlockProfileMemberResponse(member, included = null) {
    // Cleans up a member (from skyblock/profile)
    // profiles.members[]
    const statsIncluded = included == null || included.includes('stats');
    return {
        uuid: member.uuid,
        username: await cached.usernameFromUser(member.uuid),
        last_save: member.last_save,
        first_join: member.first_join,
        // last_death: ??? idk how this is formatted,
        stats: statsIncluded ? stats_1.cleanProfileStats(member.stats) : undefined,
        minions: statsIncluded ? minions_1.cleanMinions(member.crafted_generators) : undefined,
    };
}
/** Return a `CleanProfile` instead of a `CleanFullProfile`, useful when we need to get members but don't want to waste much ram */
async function cleanSkyblockProfileResponseLighter(data) {
    // We use Promise.all so it can fetch all the usernames at once instead of waiting for the previous promise to complete
    const promises = [];
    for (const memberUUID in data.members) {
        const memberRaw = data.members[memberUUID];
        memberRaw.uuid = memberUUID;
        // we pass an empty array to make it not check stats
        promises.push(cleanSkyBlockProfileMemberResponse(memberRaw, []));
    }
    const cleanedMembers = await Promise.all(promises);
    return {
        uuid: data.profile_id,
        name: data.cute_name,
        members: cleanedMembers,
    };
}
/** This function is very costly and shouldn't be called often. Use cleanSkyblockProfileResponseLighter if you don't need all the data */
async function cleanSkyblockProfileResponse(data) {
    const cleanedMembers = [];
    for (const memberUUID in data.members) {
        const memberRaw = data.members[memberUUID];
        memberRaw.uuid = memberUUID;
        const member = await cleanSkyBlockProfileMemberResponse(memberRaw, ['stats']);
        cleanedMembers.push(member);
    }
    const memberMinions = [];
    for (const member of cleanedMembers) {
        memberMinions.push(member.minions);
    }
    const minions = minions_1.combineMinionArrays(memberMinions);
    // return more detailed info
    return {
        uuid: data.profile_id,
        name: data.cute_name,
        members: cleanedMembers,
        bank: {
            balance: data?.banking?.balance ?? 0,
            // TODO: make transactions good
            history: data?.banking?.transactions ?? []
        },
        minions
    };
}
function cleanPlayerSkyblockProfiles(rawProfiles) {
    let profiles = [];
    for (const profile of Object.values(rawProfiles)) {
        profiles.push({
            uuid: profile.profile_id,
            name: profile.cute_name
        });
    }
    console.log('cleanPlayerSkyblockProfiles', profiles);
    return profiles;
}
exports.cleanPlayerSkyblockProfiles = cleanPlayerSkyblockProfiles;
/** Convert an array of raw profiles into clean profiles */
async function cleanSkyblockProfilesResponse(data) {
    const cleanedProfiles = [];
    for (const profile of data) {
        let cleanedProfile = await cleanSkyblockProfileResponseLighter(profile);
        cleanedProfiles.push(cleanedProfile);
    }
    return cleanedProfiles;
}
async function cleanResponse({ path, data }, included) {
    // Cleans up an api response
    switch (path) {
        case 'player': return await player_1.cleanPlayerResponse(data.player);
        case 'skyblock/profile': return await cleanSkyblockProfileResponse(data.profile);
        case 'skyblock/profiles': return await cleanSkyblockProfilesResponse(data.profiles);
    }
}
/**
 * Higher level function that requests the api for a user, and returns the cleaned response
 * This is safe to fetch many times because the results are cached!
 * @param included lets you choose what is returned, so there's less processing required on the backend
 * used inclusions: player, profiles
 */
async function fetchUser({ user, uuid, username }, included = ['player']) {
    if (!uuid) {
        // If the uuid isn't provided, get it
        uuid = await cached.uuidFromUser(user || username);
    }
    const includePlayers = included.includes('player');
    const includeProfiles = included.includes('profiles');
    let profilesData;
    let basicProfilesData;
    let playerData;
    if (includePlayers) {
        playerData = await cached.fetchPlayer(uuid);
        // if not including profiles, include lightweight profiles just in case
        if (!includeProfiles)
            basicProfilesData = playerData.profiles;
        playerData.profiles = undefined;
    }
    if (includeProfiles) {
        profilesData = await cached.fetchSkyblockProfiles(uuid);
    }
    let activeProfile = null;
    let lastOnline = 0;
    if (includeProfiles) {
        for (const profile of profilesData) {
            const member = profile.members.find(member => member.uuid === uuid);
            if (member.last_save > lastOnline) {
                lastOnline = member.last_save;
                activeProfile = profile;
            }
        }
    }
    return {
        player: playerData ?? null,
        profiles: profilesData ?? basicProfilesData,
        activeProfile: includeProfiles ? activeProfile?.uuid : undefined,
        online: includeProfiles ? lastOnline > (Date.now() - exports.saveInterval) : undefined
    };
}
exports.fetchUser = fetchUser;
/**
 * Fetch a CleanMemberProfile from a user and string
 * This is safe to use many times as the results are cached!
 * @param user A username or uuid
 * @param profile A profile name or profile uuid
 */
async function fetchMemberProfile(user, profile) {
    const playerUuid = await cached.uuidFromUser(user);
    const profileUuid = await cached.fetchProfileUuid(user, profile);
    const player = await cached.fetchPlayer(playerUuid);
    const cleanProfile = await cached.fetchProfile(playerUuid, profileUuid);
    const member = cleanProfile.members.find(m => m.uuid === playerUuid);
    return {
        member: {
            profileName: cleanProfile.name,
            first_join: member.first_join,
            last_save: member.last_save,
            // add all other data relating to the hypixel player, such as username, rank, etc
            ...player
        },
        profile: {
            minions: cleanProfile.minions
        }
    };
}
exports.fetchMemberProfile = fetchMemberProfile;
