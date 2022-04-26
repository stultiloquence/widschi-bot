import { MongoClient, ServerApiVersion } from 'mongodb'
import { fileURLToPath } from 'url'
import _ from 'lodash'

const credentials = fileURLToPath(new URL('X509-cert-5689221583293842508.pem', import.meta.url))
const client = new MongoClient('mongodb+srv://widschi-bot.tafbz.mongodb.net/myFirstDatabase?authSource=%24external&authMechanism=MONGODB-X509&retryWrites=true&w=majority', {
	sslKey: credentials,
	sslCert: credentials,
	serverApi: ServerApiVersion.v1,
})

// Dumb helper to access the result of the transaction because of https://jira.mongodb.org/browse/NODE-2014
const withTransaction = async (session, closure) => {
	let result
	await session.withTransaction(async (session) => {
		result = await closure(session)
		return result
	})
	return result
}

const normalizeName = name => name.toLowerCase()

const addUser = async (chatID, userID) => {
	await client.connect()
	const session = client.startSession()
	const collection = client.db('widschi-bot').collection('users')
	try {
		return await withTransaction(session, async (session) => {
			const cursor = await collection.aggregate([
				{
					$match: { chatID: chatID },
				}, {
					$group: {
						_id: null,
						average: { $avg: '$score' },
					},
				},
			], {
				session: session,
			})
			let average = 0
			for await (const first of cursor) {
				average = first.average || 0
				break
			}
			userID = normalizeName(userID)
			const newUser = {
				chatID: chatID,
				userID: userID,
				vacation: false,
				score: average,
			}

			const result = await collection.findOneAndUpdate({
				chatID: chatID,
				userID: userID,
			}, {
				$setOnInsert: newUser,
			}, {
				upsert: true,
				session: session,
			})
			if (result.value === null) {
				return newUser
			} else {
				return null
			}
		})
	} finally {
		await session.endSession()
		await client.close()
	}
}

const removeUser = async (chatID, userID) => {
	try {
		await client.connect()
		const collection = client.db('widschi-bot').collection('users')

		userID = normalizeName(userID)
		const result = await collection.findOneAndDelete({
			chatID: chatID,
			userID: userID,
		})
		return result.value
	} finally {
		await client.close()
	}
}

const toggleVacation = async (chatID, userID) => {
	try {
		await client.connect()
		const collection = client.db('widschi-bot').collection('users')

		const result = await collection.findOneAndUpdate({
			chatID: chatID,
			userID: userID,
		}, [
			{
				$set: {
					vacation: { $not: '$vacation' },
				},
			},
		], {
			returnDocument: 'after',
		})
		return result.value
	} finally {
		await client.close()
	}
}

const getUsers = async chatID => {
	try {
		await client.connect()
		const collection = client.db('widschi-bot').collection('users')

		const cursor = await collection.find({
			chatID: chatID,
		})
		const users = []
		for await (const user of cursor) {
			users.push(user)
		}
		return users
	} finally {
		await client.close()
	}
}

// Add amount to the score of a certain user. If userID === null, add amount to the score of the user with the least score.
const updateScore = async (chatID, userID, amount) => {
	await client.connect()
	const collection = client.db('widschi-bot').collection('users')
	const session = client.startSession()
	try {
		return await withTransaction(session, async (session) => {
			if (userID === null) {
				const cursor = await collection.find({
					chatID: chatID,
				}, {
					session: session,
				})
				const users = []
				for await (const user of cursor) {
					users.push(user)
				}

				if (users.length === 0) {
					throw new Error('zero users')
				}

				const notOnVacation = _.filter(users, user => !user.vacation)
				if (notOnVacation.length === 0) {
					throw new Error('zero users not on vacation')
				}

				const minScore = (_.minBy(notOnVacation, user => user.score)).score
				const candidates = _.filter(notOnVacation, user => user.score === minScore)
				const candidate = candidates[_.random(candidates.length - 1)]
				userID = candidate.userID
			}

			userID = normalizeName(userID)

			const result = await collection.findOneAndUpdate({
				chatID: chatID,
				userID: userID,
			}, {
				$inc: { score: amount },
			}, {
				returnDocument: 'after',
				session: session,
			})

			return result.value
		})
	} finally {
		await session.endSession()
		await client.close()
	}
}

export {
	updateScore,
	addUser,
	getUsers,
	removeUser,
	toggleVacation,
}