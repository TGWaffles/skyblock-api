import { collectDefaultMetrics, Gauge, register } from 'prom-client'
import { fetchServerStats, fetchServerStatus } from './database.js'
import { getKeyUsage } from './hypixelApi.js'
export { register } from 'prom-client'


// grafana integration
collectDefaultMetrics()

const apiKeyCounter = new Gauge({
	name: 'hypixel_api_key_usage',
	help: 'API requests in the past minute.',
	registers: [ register ],
	collect() {
		let keyUsage = getKeyUsage()
		apiKeyCounter.set(keyUsage.lastMinute)
	}
})
const dbSizeCounter = new Gauge({
	name: 'mongodb_db_size',
	help: 'Size of the database in bytes.',
	registers: [ register ],
	async collect() {
		let stats = await fetchServerStats()

		dbSizeCounter.set(stats.dataSize + stats.indexSize)
	}
})

