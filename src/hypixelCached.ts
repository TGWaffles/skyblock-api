/**
 * Fetch the clean and cached Hypixel API
 */

import { CleanBasicProfile, CleanFullProfile, CleanProfile } from './cleaners/skyblock/profile.js'
import { isUuid, sleep, undashUuid, withCache } from './util.js'
import { CleanFullPlayer, CleanPlayer } from './cleaners/player.js'
import * as hypixel from './hypixel.js'
import { sendUncleanApiRequest } from './hypixel.js'
import * as mojang from './mojang.js'
import NodeCache from 'node-cache'
import LRUCache from 'lru-cache'
import { CleanBasicMember } from './cleaners/skyblock/member.js'

// In future, worth logging cache hits/misses to grafana
const cacheDebug = false

/** uuid: username */
export const usernameCache = new NodeCache({
	// cache usernames for 30 minutes
	stdTTL: 60 * 30,
	checkperiod: 60,
	useClones: false,
})

usernameCache.setMaxListeners(200)


// stores player's profile uuids and names for 30 minutes
export const basicProfilesCache = new NodeCache({
	stdTTL: 60 * 30,
	checkperiod: 60,
	useClones: true,
})

// full player data with achievements, store for 5 minutes.
export const playerCache = new NodeCache({
	stdTTL: 60 * 5,
	checkperiod: 10,
	useClones: true,
})

// cache "basic players" (players without achievements) for 60 minutes
// Mainly used for player rank, username & profiles.
export const basicPlayerCache: LRUCache<string, CleanPlayer> = new LRUCache({
	ttl: 60 * 60 * 1000,
	max: 10000,
})

export const profileCache = new NodeCache({
	stdTTL: 60,
	checkperiod: 10,
	useClones: true,
})

export const profilesCache = new NodeCache({
	stdTTL: 60 * 3,
	checkperiod: 10,
	useClones: false,
})

export const profileNameCache = new NodeCache({
	// 1 hour, very unlikely that a profile name will change
	stdTTL: 60 * 60,
	checkperiod: 60,
	useClones: false,
})


interface KeyValue {
	key: any
	value: any
}

function waitForCacheSet(cache: NodeCache, key?: string, value?: string): Promise<KeyValue> {
	return new Promise((resolve, reject) => {
		const listener = (setKey, setValue) => {
			// we check that the setValue isn't a promise because it's often
			// set as a promise for this exact function
			if (((setKey === key) || (value && setValue === value)) && (!setValue?.then)) {
				cache.removeListener('set', listener)
				return resolve({ key: setKey, value: setValue })
			}
		}
		cache.on('set', listener)
	})
}

/**
 * Fetch the uuid from a user
 * @param user A user can be either a uuid or a username 
 */
export async function uuidFromUser(user: string): Promise<string | undefined> {
	// if the user is 32 characters long, it has to be a uuid
	if (isUuid(user))
		return undashUuid(user)

	if (usernameCache.has(undashUuid(user))) {
		// check if the uuid is a key
		const username: Promise<KeyValue> | string | undefined = usernameCache.get<string | Promise<KeyValue>>(undashUuid(user))

		// sometimes the username will be null, return that
		if (username === null) return undefined

		// if it has .then, then that means its a waitForCacheSet promise. This is done to prevent requests made while it is already requesting
		if ((username as Promise<KeyValue>).then) {
			const { key: uuid, value: _username } = await (username as Promise<KeyValue>)
			usernameCache.set<string | Promise<KeyValue>>(uuid, _username)
			return uuid
		} else
			return undashUuid(user)
	}

	// check if the username is a value
	const uuidToUsername: { [key: string]: string | Promise<KeyValue> } = usernameCache.mget(usernameCache.keys())
	for (const [uuid, username] of Object.entries(uuidToUsername)) {
		if (username && (<string>username).toLowerCase && user.toLowerCase() === (<string>username).toLowerCase())
			return uuid
	}

	if (cacheDebug) console.debug('Cache miss: uuidFromUser', user)

	const undashedUser = undashUuid(user)

	// set it as waitForCacheSet (a promise) in case uuidFromUser gets called while its fetching mojang
	usernameCache.set(undashedUser, waitForCacheSet(usernameCache, user, user))

	// not cached, actually fetch mojang api now
	let { uuid, username } = await mojang.profileFromUser(user)
	if (!uuid) {
		usernameCache.set(user, null)
		return
	}

	// remove dashes from the uuid so its more normal
	uuid = undashUuid(uuid)

	usernameCache.del(undashedUser)

	usernameCache.set(uuid, username)
	return uuid
}

/**
 * Fetch the username from a user
 * @param user A user can be either a uuid or a username 
 */
export async function usernameFromUser(user: string): Promise<string | null> {
	if (usernameCache.has(undashUuid(user))) {
		if (cacheDebug) console.debug('Cache hit! usernameFromUser', user)
		return usernameCache.get(undashUuid(user)) ?? null
	}

	if (cacheDebug) console.debug('Cache miss: usernameFromUser', user)

	let { uuid, username } = await mojang.profileFromUser(user)
	if (!uuid) return null
	uuid = undashUuid(uuid)
	usernameCache.set(uuid, username)
	return username
}

let fetchingPlayers: Set<string> = new Set()

function cleanFullPlayerToCleanPlayer(player: CleanFullPlayer): CleanPlayer {
	return {
		rank: player.rank,
		socials: player.socials,
		username: player.username,
		uuid: player.uuid,
		profiles: player.profiles
	}
}

export async function fetchPlayer(user: string): Promise<CleanFullPlayer | null> {
	const playerUuid = await uuidFromUser(user)
	if (!playerUuid) return null

	if (playerCache.has(playerUuid)) {
		if (cacheDebug) console.debug('Cache hit! fetchPlayer', playerUuid)
		return playerCache.get(playerUuid)!
	}
	if (cacheDebug) console.debug('Cache miss: fetchPlayer', playerUuid)

	// if it's already in the process of fetching, check every 100ms until it's not fetching the player anymore and fetch it again, since it'll be cached now
	if (fetchingPlayers.has(playerUuid)) {
		while (fetchingPlayers.has(playerUuid)) {
			await sleep(100)
		}
		return await fetchPlayer(user)
	}

	fetchingPlayers.add(playerUuid)

	const cleanPlayer = await hypixel.sendCleanApiRequest('player',
		{ uuid: playerUuid }
	)

	fetchingPlayers.delete(playerUuid)

	if (!cleanPlayer) return null

	playerCache.set(playerUuid, cleanPlayer)
	usernameCache.set(playerUuid, cleanPlayer.username)

	for (const profile of cleanPlayer.profiles ?? []) {
		profileNameCache.set(`${playerUuid}.${profile.uuid}`, profile.name)
	}

	// clone in case it gets modified somehow later
	const clonedCleanPlayer = Object.assign({}, cleanPlayer)
	const cleanBasicPlayer: CleanPlayer = cleanFullPlayerToCleanPlayer(clonedCleanPlayer)
	basicPlayerCache.set(playerUuid, cleanBasicPlayer)

	return cleanPlayer
}

/** Fetch a player without their achievements. This is heavily cached. */
export async function fetchBasicPlayer(user: string): Promise<CleanPlayer | null> {
	const playerUuid = await uuidFromUser(user)

	if (!playerUuid) return null

	if (basicPlayerCache.has(playerUuid)) {
		if (cacheDebug) console.debug('Cache hit! fetchBasicPlayer', playerUuid)
		return basicPlayerCache.get(playerUuid)!
	}
	if (cacheDebug) console.debug('Cache miss: fetchBasicPlayer', playerUuid)

	// Also caches it in future for us.
	const player = await fetchPlayer(playerUuid)
	if (!player) {
		console.debug('no player? this should never happen, perhaps the uuid is invalid or the player hasn\'t played hypixel', playerUuid)
		return null
	}
	return cleanFullPlayerToCleanPlayer(player)
}

export async function fetchSkyblockProfiles(playerUuid: string): Promise<CleanProfile[] | null> {
	if (profilesCache.has(playerUuid)) {
		if (cacheDebug) console.debug('Cache hit! fetchSkyblockProfiles', playerUuid)
		return profilesCache.get(playerUuid)!
	}

	if (cacheDebug) console.debug('Cache miss: fetchSkyblockProfiles', playerUuid)

	const profiles = await hypixel.fetchMemberProfilesUncached(playerUuid)
	if (profiles === null)
		return null

	const cleanProfiles: CleanProfile[] = []

	// create the cleanProfiles array and cache individual profiles
	for (const profile of profiles) {
		profileNameCache.set(`${playerUuid}.${profile.uuid}`, profile.name)
		profileCache.set(profile.uuid, profile)
		const basicProfile: CleanProfile = {
			name: profile.name,
			uuid: profile.uuid,
			members: profile.members?.map((m): CleanBasicMember => {
				return {
					uuid: m.uuid,
					username: m.username,
					firstJoin: m.firstJoin,
					lastSave: m.lastSave,
					rank: m.rank,
					left: m.left
				}
			}),
			mode: profile.mode
		}
		cleanProfiles.push(basicProfile)
	}

	cleanProfiles.sort((a, b) => {
		const memberA = a.members?.find(m => m.uuid === playerUuid)
		const memberB = b.members?.find(m => m.uuid === playerUuid)

		return (memberB?.lastSave ?? 0) - (memberA?.lastSave ?? 0)
	})

	const basicProfiles: CleanBasicProfile[] = cleanProfiles.map(p => {
		return {
			name: p.name,
			uuid: p.uuid
		}
	})

	// cache the profiles
	profilesCache.set(playerUuid, cleanProfiles)
	basicProfilesCache.set(playerUuid, basicProfiles)

	return cleanProfiles
}

/** Fetch an array of `BasicProfile`s */
async function fetchBasicProfiles(user: string): Promise<CleanBasicProfile[] | null> {
	const playerUuid = await uuidFromUser(user)

	if (!playerUuid) return null // invalid player, just return

	if (basicProfilesCache.has(playerUuid)) {
		if (cacheDebug) console.debug('Cache hit! fetchBasicProfiles', playerUuid)
		return basicProfilesCache.get(playerUuid)!
	}
	if (cacheDebug) console.debug('Cache miss: fetchBasicProfiles', user)

	if (basicPlayerCache.has(playerUuid)) {
		const basicPlayer = await fetchBasicPlayer(user)
		if (basicPlayer != null && basicPlayer.profiles != null) {
			return basicPlayer.profiles
		}
	}

	const cleanProfiles = await fetchSkyblockProfiles(playerUuid)

	const profiles: CleanBasicProfile[] = []
	for (const profile of cleanProfiles ?? []) {
		profiles.push({
			uuid: profile.uuid,
			name: profile.name
		})
	}

	basicProfilesCache.set(playerUuid, profiles)
	if (!profiles) return null

	// cache the profile names and uuids to profileNameCache because we can
	for (const profile of profiles)
		profileNameCache.set(`${playerUuid}.${profile.uuid}`, profile.name)

	return profiles
}

/**
 * Fetch a profile UUID from its name and user
 * @param user A username or uuid
 * @param profile A profile name or profile uuid
 */
export async function fetchProfileUuid(user: string, profile: string): Promise<string | null> {
	// if a profile wasn't provided, return
	if (!profile) {
		if (cacheDebug) console.debug('no profile provided?', user, profile)
		return null
	}

	const profileUuid = undashUuid(profile)
	if (isUuid(profileUuid)) {
		// if the profile is already a uuid, just return it
		return profileUuid
	}

	const playerUuid = await uuidFromUser(user)
	if (!playerUuid) return null

	const playerProfileNames = profileNameCache.keys().filter(k => k.substring(0, 32) === playerUuid)
	if (playerProfileNames.length > 0) {
		for (const key of playerProfileNames) {
			if (profileNameCache.get(key) === profile) {
				if (cacheDebug) console.debug('Cache hit: fetchProfileUuid', user, profile)
				return key.substring(33)
			}
		}
	}
	if (cacheDebug) console.debug('Cache miss: fetchProfileUuid', user, profile)

	const profiles = await fetchBasicProfiles(user)
	if (!profiles) return null // user probably doesnt exist

	for (const p of profiles) {
		if (p.name?.toLowerCase() === profileUuid.toLowerCase())
			return undashUuid(p.uuid)
		else if (undashUuid(p.uuid) === undashUuid(profileUuid))
			return undashUuid(p.uuid)
	}
	return null
}

/**
 * Fetch an entire profile from the user and profile data
 * @param user A username or uuid
 * @param profile A profile name or profile uuid
 */
export async function fetchProfile(user: string, profile: string): Promise<CleanFullProfile | null> {
	const playerUuid = await uuidFromUser(user)
	if (!playerUuid) return null
	const profileUuid = await fetchProfileUuid(playerUuid, profile)

	if (!profileUuid) return null

	if (profileCache.has(profileUuid)) {
		// we have the profile cached, return it :)
		if (cacheDebug) console.debug('Cache hit! fetchProfile', profileUuid)
		return profileCache.get(profileUuid)!
	}

	if (cacheDebug) console.debug('Cache miss: fetchProfile', user, profile)

	const profileName = await fetchProfileName(user, profile)

	if (!profileName) return null // uhh this should never happen but if it does just return null

	const cleanProfile = await hypixel.fetchMemberProfileUncached(profileUuid)
	if (!cleanProfile) return null

	// we know the name from fetchProfileName, so set it here
	cleanProfile.name = profileName

	profileCache.set(profileUuid, cleanProfile)

	return cleanProfile
}

/**
 * Fetch the name of a profile from the user and profile uuid
 * @param user A player uuid or username
 * @param profile A profile uuid or name
 */
export async function fetchProfileName(user: string, profile: string): Promise<string | null> {
	// we're fetching the profile and player uuid again in case we were given a name, but it's cached so it's not much of a problem
	const profileUuid = await fetchProfileUuid(user, profile)
	if (!profileUuid) return null

	const playerUuid = await uuidFromUser(user)

	if (!playerUuid) return null

	if (profileNameCache.has(`${playerUuid}.${profileUuid}`)) {
		// Return the profile name if it's cached
		if (cacheDebug) console.debug('Cache hit! fetchProfileName', profileUuid)
		return profileNameCache.get!(`${playerUuid}.${profileUuid}`) ?? null
	}
	if (cacheDebug) console.debug('Cache miss: fetchProfileName', user, profile)

	const basicProfiles = await fetchBasicProfiles(playerUuid)

	if (!basicProfiles) return null

	let profileName = profile // we default to the profile uuid provided

	for (const basicProfile of basicProfiles) {
		if (basicProfile.uuid && basicProfile.name) {
			profileNameCache.set(`${playerUuid}.${basicProfile.uuid}`, basicProfile.name)
			if (basicProfile.uuid == profileUuid || basicProfile.name == profile) {
				// Matches!
				profileName = basicProfile.name
			}
		}
	}

	return profileName
}

export async function fetchAchievements() {
	return await withCache(
		'achievements',
		30 * 60 * 1000,
		async () => {
			return (await sendUncleanApiRequest('resources/achievements', {})).achievements
		}
	)
}

