import { Included } from '../../hypixel'
import * as cached from '../../hypixelCached'
import { CleanPlayer } from '../player'
import { Bank } from './bank'
import { cleanFairySouls, FairySouls } from './fairysouls'
import { cleanInventories, INVENTORIES } from './inventory'
import { CleanMinion, cleanMinions } from './minions'
import { CleanFullProfile } from './profile'
import { CleanProfileStats, cleanProfileStats } from './stats'

export interface CleanBasicMember {
    uuid: string
    username: string
    last_save: number
    first_join: number
}

export interface CleanMember extends CleanBasicMember {
    stats?: CleanProfileStats
    minions?: CleanMinion[]
	bank?: Bank
	fairy_souls?: FairySouls
    inventories: typeof INVENTORIES
}


/** Cleans up a member (from skyblock/profile) */
export async function cleanSkyBlockProfileMemberResponse(member, included: Included[] = null): Promise<CleanMember> {
    // profiles.members[]
    const statsIncluded = included == null || included.includes('stats')
    return {
        uuid: member.uuid,
        username: await cached.usernameFromUser(member.uuid),
        last_save: member.last_save,
        first_join: member.first_join,
        // last_death: ??? idk how this is formatted,
        stats: statsIncluded ? cleanProfileStats(member?.stats) : undefined,
        minions: statsIncluded ? cleanMinions(member) : undefined,
		fairy_souls: statsIncluded ? cleanFairySouls(member) : undefined,
		inventories: statsIncluded ? await cleanInventories(member) : undefined,
    }
}


export interface CleanMemberProfilePlayer extends CleanPlayer {
    // The profile name may be different for each player, so we put it here
    profileName: string
    first_join: number
    last_save: number
    bank?: Bank
}

export interface CleanMemberProfile {
    member: CleanMemberProfilePlayer
    profile: CleanFullProfile
}
