
const crypto = require('crypto')
const dgram = require('dgram')

const {decode, encode} = require('bencode')

const udp = dgram.createSocket('udp4')
const nodeId = crypto.randomBytes(20)

const bootstrapLocs = [{host: 'router.bittorrent.com', port: 6881}, {host: 'router.utorrent.com', port: 6881}]

const magnetId = '-- ENTER MAGNET ID --'

const peers = {}
const queries = {}

let tCount = 0 // transaction id counter


const intToBuffer = (d) => Buffer.from(d.toString(16).padStart(4, '0'), 'hex')
const bufferToInt = (b) =>  parseInt(b.toString('hex'), 16)
const splitBuffer = (b, n) => Array.from({length: b.length / n}).map((_, i) => b.subarray(n * i, n * (i + 1)))

const getIpPortFromBuffer = (buffer) => {
  const address = buffer.slice(0, 4).join('.')
  const port = parseInt(buffer.slice(4).toString('hex'), 16)
  return { address, port }
}

const queryOutgoing = async (query, args, address, port) => {
  
  // save pending query
  const t = tCount.toString()
  queries[tCount.toString()] = {}
  tCount++

  // send message
  const message = { t: intToBuffer(t), y: 'q', q: query, a: {...args, id: nodeId} }
  udp.send(encode(message), port, address)

  // wait response or timeout
  await new Promise(r => {
    let i = 0
    setInterval(() => { if (queries[t].r || i > 20) r(); else i++ }, 250)
  })

  return queries[t].r
}

const queryResponse = async (type, message, rinfo) => {
  
  // check incorrect types
  if (type === 'r' && !(message.r && message.r.id)) return
  if (type === 'e' && !message.e) return
  
  // check if own request
  const t = bufferToInt(message.t).toString()
  if (!Object.keys(queries).includes(t)) return
  
  // update query response
  queries[t].r = message.r

  // response to query
  if (type === 'r') {
    const peerId = message.r.id.toString('hex')
    peers[peerId] = {address: rinfo.address, port: rinfo.port}
  } else if (type === 'e') {
    // something went wrong
  }
  
}

const getPeers = async (address, port, magnetId, parentIds = []) => {

  const response = await queryOutgoing('get_peers', { info_hash: Buffer.from(magnetId, 'hex') }, address, port)
  if (response?.values) {
    const values = response.values.map(v => ({...getIpPortFromBuffer(v), path: parentIds.concat([{id: response.id.toString('hex'), address, port}])}))
    values.forEach(v => console.log(`${v.address}:${v.port} (nodeId=${response.id.toString('hex')})`))
    return values
  } else if (response?.nodes) {
    const promises = splitBuffer(response.nodes, 26)
      .map((c) => {
        const {address, port} = getIpPortFromBuffer(c.subarray(20, 26))
        return getPeers(address, port, Buffer.from(magnetId, 'hex'), parentIds.concat([{id: response.id.toString('hex'), address, port}]))
      })
    const rest = await Promise.all(promises)
    return rest.flat()
  } else {
    return []
  }
}

;(async () => {

  udp.bind(6881)

  udp.once('listening', async () => {

    // log messages
    console.log(`udp server listening on port => ${udp.address().port}`)
    console.log()
    
    // get bootlocs
    console.log(`booting from =>  ${bootstrapLocs[0].host}`)
    console.log(`node id => ${nodeId.toString('hex')}`)
    console.log(`magnet id => ${magnetId}`)
    console.log()

    // find magnet peers
    console.log('closest to magnet =>')
    const bootstrapPeers = bootstrapLocs.map((l) => getPeers(l.host, l.port, magnetId))
    const peersFound = await Promise.all(Array(2).fill().map(() => bootstrapPeers).flat()) // replication = 2
    console.log(`Found ${[...new Set(peersFound)].flat().length} peers`)
    console.log()
    
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
