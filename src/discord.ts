import { fetch } from 'undici'

const DISCORD_CLIENT_ID = '937105508320546896'


export interface TokenResponse {
	access_token: string
	expires_in: number
	refresh_token: string
	scope: string
	token_type: string
}

/**
 * The information about the Discord user that's directly returned by the
 * Discord API
 */
export interface DiscordUser {
	id: string
	username: string
	avatar: string
	discriminator: string
	public_flags: number
	flags: number
	locale: string
	mfa_enabled: boolean
}

export async function exchangeCode(redirectUri: string, code: string): Promise<TokenResponse | null> {
	const API_ENDPOINT = 'https://discord.com/api/v6'
	const CLIENT_SECRET = process.env.discord_client_secret
	if (!CLIENT_SECRET) {
		console.error('discord_client_secret isn\'t in env, couldn\'t login with discord')
		return null
	}
	const data = {
		'client_id': DISCORD_CLIENT_ID,
		'client_secret': CLIENT_SECRET,
		'grant_type': 'authorization_code',
		'code': code,
		'redirect_uri': redirectUri,
		'scope': 'identify'
	}
	const fetchResponse = await fetch(
		API_ENDPOINT + '/oauth2/token',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(data).toString()
		}
	)
	return await fetchResponse.json() as TokenResponse | null
}


export async function getUser(accessToken: string): Promise<DiscordUser> {
	const API_ENDPOINT = 'https://discord.com/api/v6'
	const response = await fetch(
		API_ENDPOINT + '/users/@me',
		{
			headers: { 'Authorization': 'Bearer ' + accessToken },
		}
	)
	return await response.json() as DiscordUser
}
