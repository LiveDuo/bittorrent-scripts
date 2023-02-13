
const crypto = require('crypto')
const dgram = require('dgram')

const {decode, encode} = require('bencode')

const udp = dgram.createSocket('udp4')
const nodeId = crypto.randomBytes(20)

const bootstrapNode = {host: 'router.bittorrent.com', port: 6881}

const magnetId = '-- ENTER MAGNET ID --'

let response = {}

const intToBuffer = (d) => Buffer.from(d.toString(16).padStart(4, '0'), 'hex')
const bufferToInt = (b) =>  parseInt(b.toString('hex'), 16)
const splitBuffer = (b, n) => Array.from({length: b.length / n}).map((_, i) => b.subarray(n * i, n * (i + 1)))
const getIpPortFromBuffer = (b) => ({ address: b.slice(0, 4).join('.'), port: bufferToInt(b.slice(4)) })

const queryOutgoing = async (query, args, address, port) => {

  // send message
  const message = encode({ t: intToBuffer('0'), y: 'q', q: query, a: {...args, id: nodeId} })
  udp.send(message, port, address)

  // wait response (or timeout)
  await new Promise(r => { let i = 0; setInterval(() => { if (response.r || i > 20) r(); else i++ }, 250) })

  return response.r
}

const queryResponse = async (type, message, rinfo) => {
  
  // check incorrect types
  if (type === 'r' && !(message.r && message.r.id)) return
  else if (type === 'e' && !message.e) return
  else if (type === 'r') {
    console.log('received:', {address: rinfo.address, port: rinfo.port})
  } else if (type === 'e') {
    console.log('something went wrong')
  }

  // update query response
  response.r = message.r
  
}

;(async () => {

  udp.bind(6881)

  udp.once('listening', async () => {

    // log messages
    console.log(`udp server listening on port => ${udp.address().port}`)
    console.log()
    
    // find torrent peers
    console.log(`sending "get_peers" (hash=${magnetId.slice(0, 4)}...${magnetId.slice(-4)}) to ${bootstrapNode.host}`)
    const response = await queryOutgoing('get_peers', { info_hash: Buffer.from(magnetId, 'hex') }, bootstrapNode.host, bootstrapNode.port)
    if (response?.values) {
      console.log('nodes:', response.values.map(v => ({...getIpPortFromBuffer(v), path: parentIds.concat([{id: response.id.toString('hex'), address, port}])})))
    } else if (response?.nodes) {
      console.log('values:', splitBuffer(response.nodes, 26).map((c) => getIpPortFromBuffer(c.subarray(20, 26))))
    }
    
  })
  
  udp.on('message', async (message, rinfo) => {
    try {
      const decoded = decode(message)
      const type = decoded?.y?.toString()
      if (type === 'r' || type === 'e') {
        await queryResponse(type, decoded, rinfo)
      }
    } catch (e) {
      console.log('error', e)
    }
  })

})()
