
const net = require('net')
const crypto = require('crypto')

const socket = new net.Socket()

const magnetId = '-- ENTER MAGNET ID --'
const address = '-- ENTER NODE IP --'
const port = '-- ENTER NODE PORT --'

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

const handleMessage = (msg) => {
	
	if (isHandshake(msg.subarray(0, 4))) {
		console.log('handshake')
	} else {
		const id = bufferToInt(msg.subarray(4, 5))
		if (id === 0) {
			console.log('choke')
		} else if (id === 1) {
			console.log('unchoke')
		} else if (id === 4) {
			console.log('have')
		} else if (id === 5) {
			console.log('bitfield')
		} else {
			console.log('unknown')
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
