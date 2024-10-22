/**
 * Fetch the raw Hypixel API
 */
import { shuffle, sleep } from './util.js'
import typedHypixelApi from 'typed-hypixel-api'
import { Agent } from 'https'

if (!process.env.hypixel_key)
	// if there's no hypixel key in env, run dotenv
	(await import('dotenv')).config({path: process.env.ENV_FILE ? process.env.ENV_FILE : '.env'})


/** This array should only ever contain one item because using multiple hypixel api keys isn't allowed :) */
let apiKey = process.env?.hypixel_key

if (apiKey === undefined || apiKey.length === 0) {
	console.warn('Warning: hypixel_keys was not found in .env. This will prevent the program from using the Hypixel API.')
}

export function getApiKey() {
	return apiKey
}

interface KeyUsage {
	remaining: number
	limit: number
	reset: number
	inflight: number
}

const apiKeyUsage: KeyUsage = {
	remaining: 300,
	limit: 300,
	// reset in 300s
	reset: Date.now() + 300*1000,
	inflight: 0
}
// the usage amount the api key was on right before it reset
let apiKeyMaxUsage: number = 0


export function getKeyUsage() {
	return {
		limit: apiKeyUsage.limit,
		remaining: apiKeyUsage.remaining,
		reset: apiKeyUsage.reset,
		maxUsage: apiKeyMaxUsage,
		lastMinute: requestTimestamps.filter(timestamp => timestamp.getTime() > Date.now() - 60000).length,
		inFlight: apiKeyUsage.inflight
	}
}

export interface HypixelResponse {
	[key: string]: any | {
		success: boolean
		throttled?: boolean
	}
}


export interface HypixelPlayerStatsSkyBlockProfiles {
	[uuid: string]: {
		profile_id: string
		cute_name: string
	}
}

interface HypixelPlayerStatsSkyBlock {
	profiles: HypixelPlayerStatsSkyBlockProfiles
}

export interface HypixelPlayerSocialMedia {
	YOUTUBE?: string
	prompt: boolean
	links: {
		DISCORD?: string
		HYPIXEL?: string
	}
}

async function waitForRateLimit() {
	while (apiKeyUsage.remaining - apiKeyUsage.inflight < 2) {
		// ran out / about to run out of requests.
		if (apiKeyUsage.reset < Date.now()) {
			// reset time has passed
			apiKeyUsage.remaining = apiKeyUsage.limit
			apiKeyUsage.reset = Date.now() + 300 * 1000
		}
		await sleep(Date.now() - apiKeyUsage.reset)
	}
	// add this request as inflight
	apiKeyUsage.inflight++
	// proceed with request
}

/**
 * A list of Dates for requests that were sent in the past 60 seconds.
 * This is used for calculating the approximate request count.
 */
let requestTimestamps: Date[] = []
let lastRateLog = Date.now()

/** Send an HTTP request to the Hypixel API */
export let sendApiRequest = async<P extends keyof typedHypixelApi.Requests>(
	path: P,
	options: typedHypixelApi.Requests[P]['options'],
	attemptCount = 0
): Promise<typedHypixelApi.Requests[P]['response']['data']> => {
	if ('key' in options) {
		if (options.key == null) {
			throw new Error('No Hypixel API key found')
		}
		// Ensure we haven't passed the rate limit
		await waitForRateLimit()
	}
	const optionsWithoutKey: any = { ...options }
	if ('key' in optionsWithoutKey) delete optionsWithoutKey.key
	console.log(`Sending API request to ${path} with options ${JSON.stringify(optionsWithoutKey)}. Rate limit remaining: ${apiKeyUsage.remaining}`)

	// rate calculation
	requestTimestamps.push(new Date())
	requestTimestamps = requestTimestamps.filter(timestamp => timestamp.getTime() > Date.now() - 60000)
	// log every minute
	if (Date.now() > lastRateLog + 60000) {
		lastRateLog = Date.now()
		console.info(`${requestTimestamps.length} Hypixel API requests in past minute`)
	}

	// Send a raw http request to api.hypixel.net, and return the parsed json
	let response: typedHypixelApi.Requests[P]['response']
	try {
		response = await typedHypixelApi.request(
			path,
			options
		)
	} catch (e) {
		apiKeyUsage.inflight--
		console.log(`Error ${e} sending API request to ${path} with options ${JSON.stringify(optionsWithoutKey)}, retrying in a scond`)
		await sleep(1000)
		return await sendApiRequest(path, options, attemptCount + 1)
	}
	apiKeyUsage.inflight--

	if (!response.data.success) {
		// bruh
		if (response.data.cause === 'This endpoint is currently disabled') {
			console.log(`API request to ${path} with options ${JSON.stringify(optionsWithoutKey)} failed because the endpoint is disabled, retrying in 30 seconds`)
			await sleep(30000)
			return await sendApiRequest(path, options, attemptCount + 1)
		}

		if ('key' in options && response.data.cause === 'Invalid API key') {
			apiKey = ''
			throw new Error('Invalid API key')
		}

		console.log(`API request to ${path} with options ${JSON.stringify(optionsWithoutKey)} was not successful: ${JSON.stringify(response.data)}`)
	}

	if ('key' in options && response.headers['ratelimit-limit']) {
		if (response.headers['ratelimit-remaining']) {
			apiKeyUsage.remaining = response.headers['ratelimit-remaining']
		}
		if (response.headers['ratelimit-limit']) {
			apiKeyUsage.limit = response.headers['ratelimit-limit']
		}
		if (response.headers['ratelimit-reset']) {
			apiKeyUsage.reset = Date.now() + response.headers['ratelimit-reset'] * 1000 + 1000
		}
		// remember how many uses it has
		let usage = apiKeyUsage.limit - apiKeyUsage.remaining
		// if it's not in apiKeyMaxUsage or this usage is higher, update it
		if (usage > apiKeyMaxUsage) {
			apiKeyMaxUsage = usage
		}
	}

	if ('key' in options && !response.data.success && 'throttle' in response.data && response.data.throttle) {
			apiKeyUsage.remaining = 0

		if (attemptCount > 3) {
			console.log(`API request to ${path} with options ${JSON.stringify(optionsWithoutKey)} was throttled too many times, giving up`)
			throw new Error('Throttled')
		}

		// if it's throttled, wait until ratelimit reset & try again
		let timeToWait = (apiKeyUsage.reset - Date.now())
		if (timeToWait < 0) {
			// Wait 10 seconds minimum.
			timeToWait = 10*1000
		}
		console.log(`API request to ${path} with options ${JSON.stringify(optionsWithoutKey)} was throttled, retrying in ${timeToWait/1000} seconds`)
		await sleep(timeToWait)
		return await sendApiRequest(path, options, attemptCount + 1)
	}
	return response.data
}

// this is necessary for mocking in the tests because es6
export function mockSendApiRequest($value) { sendApiRequest = $value }
