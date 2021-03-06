let EventEmitter = require('events').EventEmitter,
    crypto = require('crypto'),
    dgram = require('dgram')

module.exports = {
    createServer (port, host) {
        return new udpProtoServer(port, host)
    },

    connect(port, host, localPort = null) {
        return new udpProtoSocket(null, null, {
            localPort: localPort,
            remoteHost: host,
            remotePort: port
        })
    }
}

class udpProtoSocket extends EventEmitter {
    constructor (SessionId, SequenceNumber = 0, options = {}) {
        super()

        this.udpSocket = dgram.createSocket('udp4')
        this.options = options

        this.udpSocket.on('connect', () => { console.log('udp connected') })
        this.udpSocket.on('error', (err) => { console.log('udp err', err) })

        this.udpSocket.connect(this.options.remotePort, this.options.remoteHost, (err) => {
            if (err) console.log('error', err)
        })

        if (!this.options.localPort) {
            this.localServer = new udpProtoServer(null, '0.0.0.0', [this])
            this.localServer.on('listening', (port) => {
                console.log('tmp listen:', port)
                this.options.localPort = port
            })
        }

        this.sessionIdByte = crypto.randomBytes(4)
        this.sessionId = SessionId || this.sessionIdByte.readUIntLE(0, 4)
        this.SequenceNumber = (SequenceNumber && SequenceNumber < 2 ** 32 - 16) ? SequenceNumber : 0
    }

    write (message) {
        console.log('write')

        let msg = Buffer.alloc(6);

        this.SequenceNumber++
        console.log('localPort', this.options.localPort)
        msg.writeUInt16LE(this.options.localPort, 0)
        console.log('msg1', msg)
        msg.writeUInt32LE(this.SequenceNumber, 2)
        msg = Buffer.concat([
            msg,
            this.sessionIdByte,
            message
        ])
        console.log(msg)
        console.log('send', this.options.remotePort, this.options.remoteHost)
        this.udpSocket.send(msg)
        /*this.udpSocket.connect(this.options.remotePort, this.options.remoteAddress, (err) => {
            if (err) console.log('error', err)

            this.udpSocket.send(msg, 0, msg.length, this.options.remotePort, this.options.remoteAddress)
        })*/
    }
}

class udpProtoServer extends EventEmitter {
    constructor (port, host, sockets = [], options = {}) {
        super()

        this.sockets = sockets || []

        this.server = dgram.createSocket('udp4')
        if (port) {
            this.server.bind(port)
            this.localPort = port

            this.server.on('listening', () => {
                this.emit('listening', port)
            })
            this.server.on('message', (msg, rinfo) => { this.onMessage(msg, rinfo) });
        } else {
            let startPort = 10000,
                endPort =65535;

            (async () => {
                let tryPort = async () => {
                    let tmpSocket = dgram.createSocket('udp4')
                    tmpSocket.bind(startPort, host)

                    tmpSocket.on('listening', () => {
                        this.server = tmpSocket
                        this.localPort = startPort
                        this.emit('listening', startPort)
                        this.server.on('message', (msg, rinfo) => { this.onMessage(msg, rinfo) });
                    })

                    tmpSocket.on('error', async (err) => {
                        if (++startPort > endPort) {
                            this.emit('error', new Error('No Ports is available'))
                        } else {
                            await tryPort()
                        }
                    })
                }
                await tryPort()
            })()
        }

    }

    onMessage (msg, rinfo) {
        // UDP Proto Format (LE):
        // 2 Bytes of UInt - Receive Port
        // 4 Bytes of UInt - Session Id
        // 4 Bytes of UInt - Sequence Number
        // Lefts - Payload

        let ReceivePort = msg.readUIntLE(0, 2),
            SessionId = msg.readUIntLE(2, 4),
            SequenceNumber = msg.readUIntLE(6, 4),
            Payload = msg.slice(10)

        console.log('receiving', ReceivePort, SessionId, SequenceNumber, Payload, msg)

        let socket = this.sockets.filter(item => item.sessionId === SessionId)

        console.log(socket)

        if (socket.length > 0) {
            socket = socket[0]
            socket.emit('data', Payload)
        } else {
            socket = new udpProtoSocket(SessionId, SequenceNumber, {
                localPort: this.localPort,
                remoteSentPort: rinfo.port,
                remoteHost: rinfo.address,
                remotePort: ReceivePort
            })
            this.sockets.push(socket)
            this.emit('connect', socket)
            socket.emit('data', Payload)
        }
    }
}
