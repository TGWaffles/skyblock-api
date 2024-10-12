import typedHypixelApi from 'typed-hypixel-api'
import { headIdFromBase64 } from './inventory.js'
import { cleanItemId } from './itemId.js'

export interface ItemRequirement {
    dungeon?: {
        type: string
        level: number
    }
    skill?: {
        type: string
        level: number
    }
    slayer?: {
        boss: string
        level: number
    }
}

// based on Item from inventory.ts
export interface ItemListItem {
    id: string
    headTexture?: string
    vanillaId: string
    tier: string | null
    display: {
        name: string
        glint: boolean
    }
    npcSellPrice: number | null
    requirements: ItemRequirement
    category: string | null
    soulbound: boolean
    museum: boolean
}

export interface ItemListData {
    lastUpdated: number
    list: ItemListItem[]
}

function cleanItemRequirements(data: typedHypixelApi.SkyBlockItemsResponse['items'][number]['requirements'], catacombsRequirements: typedHypixelApi.SkyBlockItemsResponse['items'][number]['catacombs_requirements']): ItemRequirement {
    if (!data) return {}
    let requirement: ItemRequirement = {
        dungeon: undefined,
        skill: undefined,
        slayer: undefined
    }
    for (const req of data) {
        if (req.type === 'DUNGEON_SKILL') {
            requirement.dungeon = {
                type: req.dungeon_type,
                level: req.level
            }
        } else if (req.type === 'SKILL') {
            requirement.skill = {
                type: req.skill.toLowerCase(),
                level: req.level
            }
        } else if (req.type === 'SLAYER') {
            requirement.slayer = {
                boss: req.slayer_boss_type,
                level: req.level
            }
        }
    }
    if (!requirement.dungeon && catacombsRequirements) {
        // Fallback to "catacombsRequirements" field if there wasn't a dungeon requirement in the "requirements" field
        for (const req of catacombsRequirements) {
            if (req.type === 'DUNGEON_SKILL') {
                requirement.dungeon = {
                    type: req.dungeon_type,
                    level: req.level
                }
            }
        }
    }
    return requirement;
}

function cleanItemListItem(item: typedHypixelApi.SkyBlockItemsResponse['items'][number]): ItemListItem {
    const vanillaId = cleanItemId(item.durability ? `${item.material}:${item.durability}` : item.material)
    return {
        id: item.id,
        headTexture: (item.material === 'SKULL_ITEM' && 'skin' in item) && item.skin ? headIdFromBase64(item.skin) : undefined,
        vanillaId,
        tier: item.tier ?? null,
        display: {
            name: item.name,
            glint: item.glowing ?? false
        },
        npcSellPrice: item.npc_sell_price ?? null,
        requirements: cleanItemRequirements(item.requirements, item.catacombs_requirements),
        category: item.category?.toLowerCase() ?? null,
        soulbound: !!item.soulbound,
        museum: item.museum ?? false
    }
}

export async function cleanItemListResponse(data: typedHypixelApi.SkyBlockItemsResponse): Promise<ItemListData> {
    return {
        lastUpdated: data.lastUpdated,
        list: data.items.map(cleanItemListItem)
    }
}