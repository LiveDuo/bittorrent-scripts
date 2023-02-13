
const net = require('net')
const crypto = require('crypto')
const { encode, decode } = require('bencode')

const socket = new net.Socket()

const PIECE_BLOCK_SIZE = 2 ** 10 // 1kb
const METADATA_BLOCK_SIZE = 2 ** 14 // 16kb

const magnetId = '-- ENTER MAGNET ID --'
const address = '-- ENTER NODE IP --'
const port = '-- ENTER NODE PORT --'

const metadataInfo = { pieces: {}, size: null }

const intToBuffer = (b, n) => Buffer.from(b.toString(16).padStart(n, '0'), 'hex')
const bufferToInt = (b) => parseInt(b.toString('hex'), 16)

const isHandshake = (b) => b.subarray(1).toString() === 'BitTorrent Protocol'.substring(0, 3)

const getHandshakeMessage = () => {
	const protocolString = Buffer.from('BitTorrent protocol', 'utf-8')
  const length = Buffer.from(protocolString.length.toString(16), 'hex')
  const reserved = Buffer.from('0000000000100001', 'hex') // extended flag
  const infoHash = Buffer.from(magnetId, 'hex')
	const peerId = Buffer.from('-AT0001-', 'utf-8')
	const random = crypto.randomBytes(12)
  return Buffer.concat([length, protocolString, reserved, infoHash, peerId, random])
}

const getRequestMessage = (id, payload) => {
	const messageLength = intToBuffer(payload.length + 1, 8)
  const messageId = intToBuffer(id, 2)
  return Buffer.concat([messageLength, messageId, payload])
}

const getRequestExtensionMessage = (id, extId, payload) => {
	const messageLength = intToBuffer(payload.length + 2, 8)
  const messageId = intToBuffer(id, 2)
  const extensionId = intToBuffer(extId, 2)
	return Buffer.concat([messageLength, messageId, extensionId, payload])
}

const handleMessage = (msg) => {
	
	if (isHandshake(msg.subarray(0, 4))) {
		console.log('handshake')
	} else {
		const id = bufferToInt(msg.subarray(4, 5))
		if (id === 0) {
			console.log('choke')
			socket.end()
		} else if (id === 1) {
			console.log('unchoke')
			const payload = Buffer.concat([intToBuffer(0, 8), intToBuffer(0, 8), intToBuffer(PIECE_BLOCK_SIZE, 8)])
			socket.write(getRequestMessage(6, payload)) // unchoke
		} else if (id === 4) {
			console.log('have')
		} else if (id === 5) {
			console.log('bitfield')
		} else if (id === 7) {
			
			console.log('piece')

			const index = bufferToInt(msg.subarray(5, 9))
			if (index !== 0) { console.log('invalid index', index); return }

			const begin = bufferToInt(msg.subarray(9, 13))
			if (begin !== 0) { console.log('invalid begin', begin); return }
			
			const block = msg.subarray(13)
			if (block.length !== PIECE_BLOCK_SIZE) { console.log('invalid block', begin); return }

			const fileSize = 140
			const pieceSample = block.subarray(0, fileSize).toString()
			console.log(pieceSample)
			process.exit()

		} else if (id === 9) {
			const portString = bufferToInt(msg.subarray(5)).toString()
			console.log('port', `(${portString})`)
		} else if (id === 20) {

			const extendedId = bufferToInt(msg.subarray(5, 6))
			const decoded = decode(msg.subarray(6), 'utf8')

			if (extendedId === 0) {
				console.log('extended (handshake)')

				// extension header
				const payload = encode({ m: { ut_metadata: decoded.m.ut_metadata } })
				socket.write(getRequestExtensionMessage(20, 0, payload))

				// request pieces
				const blocksNumber = Math.ceil(decoded.metadata_size / METADATA_BLOCK_SIZE)
				;[...Array(blocksNumber)].forEach((_, i) => {
					const payload2 = encode({ msg_type: 0, piece: i })
					socket.write(getRequestExtensionMessage(20, 2, payload2))
				})

				// save metadata size
				metadataInfo.size = decoded.metadata_size
				
			} else {
				console.log(`extended (id=${extendedId})`)
				const content = msg.subarray(6)
				const delimiter = content.toString('ascii').indexOf('ee')
				
				const message = decode(content.subarray(0, delimiter + 2))
				const data = content.subarray(delimiter + 2)
				console.log('metadata piece', message.piece.toString(), `(size=${data.length})`)

				// save piece data
				metadataInfo.pieces[message.piece] = data

				// check pieces length
				const blocksNumber = Math.ceil(metadataInfo.size / METADATA_BLOCK_SIZE)
				const piecesLength = Object.keys(metadataInfo.pieces).length
				if (piecesLength !== blocksNumber) return
				
				// check pieces total size
				const pieces = Object.values(metadataInfo.pieces)
				const piecesTotalLength = pieces.reduce((s, b) => s + b.length, 0)
				if (metadataInfo.size !== piecesTotalLength) { console.log('invalid metadata length'); return }

				// print files
				const decoded = decode(Buffer.concat(pieces), 'utf8')
				console.log(decoded.files.map(f => f.path[0]))

				socket.write(getRequestMessage(2, Buffer.alloc(0))) // interested
			}
			
		} else {
			console.log('unknown', id)
		}
	}
}

;(async () => {

	let savedBuffer = Buffer.alloc(0)

	socket.connect(port, address, () => { console.log(`connected to ${address}:${port}\n`);  socket.write(getHandshakeMessage()) })
	socket.on('data', (buffer) => {

		let index = 0

		const newBuffer = Buffer.concat([savedBuffer, buffer])
		while (index <= newBuffer.length) {
			
			const prefix = newBuffer.subarray(index, index + 4)
			const messageLength = isHandshake(prefix) ? getHandshakeMessage().length : bufferToInt(prefix) + 4
			if (newBuffer.length >= messageLength) {
				handleMessage(newBuffer.subarray(index, index + messageLength))
				savedBuffer = newBuffer.subarray(index)
			}

			index += messageLength
		}

	})
	
	socket.on('error', (e) => { console.log(e.message) })
})()
