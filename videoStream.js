const ws = require('ws');
const util = require('util');
const events = require('events');
const Mpeg1Muxer = require('./mpeg1muxer');

const STREAM_MAGIC_BYTES = 'jsmp'; // Must be 4 bytes

const VideoStream = function ({
	name,
	stream: inputStream,
	streamUrl,
	width,
	height,
	wsPort,
	ffmpegOptions,
	ffmpegPath,
	onConnect,
}) {
	Object.assign(this, {
		ffmpegOptions,
		ffmpegPath,
		name,
		inputStream,
		streamUrl,
		width,
		height,
		wsPort,
		inputStreamStarted: false,
		stream: undefined,
		onConnect,
	});

	this.startMpeg1Stream();
	this.pipeStreamToSocketServer();
	return this;
};

util.inherits(VideoStream, events.EventEmitter);

VideoStream.prototype.stop = function () {
	this.wsServer.close();
	this.stream.kill();
	this.inputStreamStarted = false;
	return this;
};

VideoStream.prototype.startMpeg1Stream = function () {
	const { ffmpegOptions, streamUrl, inputStream, ffmpegPath } = this;
	this.mpeg1Muxer = new Mpeg1Muxer({
		ffmpegOptions,
		streamUrl,
		inputStream,
		ffmpegPath: ffmpegPath || 'ffmpeg',
	});

	this.stream = this.mpeg1Muxer.stream;
	if (this.inputStreamStarted) {
		return;
	}

	this.mpeg1Muxer.on('mpeg1data', (data) => {
		return this.emit('camdata', data);
	});

	let gettingInputData = false;
	const inputData = [];
	this.mpeg1Muxer.on('ffmpegStderr', (data) => {
		let size;
		data = data.toString();

		if (data.indexOf('Input #') !== -1) {
			gettingInputData = true;
		} else if (data.indexOf('Output #') !== -1) {
			gettingInputData = false;
		}

		if (gettingInputData) {
			inputData.push(data.toString());

			size = data.match(/\d+x\d+/);
			if (size != null) {
				size = size[0].split('x');
				if (this.width == null) {
					this.width = parseInt(size[0], 10);
				}

				if (this.height == null) {
					this.height = parseInt(size[1], 10);
				}
			}
		}
	});

	this.mpeg1Muxer.on('ffmpegStderr', function (data) {
		return global.process.stderr.write(data);
	});

	this.mpeg1Muxer.on('exitWithError', () => {
		return this.emit('exitWithError');
	});

	return this;
};

VideoStream.prototype.pipeStreamToSocketServer = function () {
	this.wsServer = new ws.Server({
		port: this.wsPort,
	});

	this.wsServer.on('connection', (socket, request) => {
		return this.onSocketConnect(socket, request);
	});

	this.wsServer.broadcast = function (data, opts) {
		let results;
		results = [];
		for (let client of this.clients) {
			if (client.readyState === 1) {
				results.push(client.send(data, opts));
			} else {
				results.push(
					console.log(
						`Error: Client from remoteAddress ${client.remoteAddress} not connected.`,
					),
				);
			}
		}
		return results;
	};

	return this.on('camdata', (data) => {
		return this.wsServer.broadcast(data);
	});
};

VideoStream.prototype.onSocketConnect = async function (socket, request) {
	const { onConnect, width, height, wsServer, name } = this;
	if (onConnect) {
		if (!(await onConnect({ request }))) {
			console.warn(
				`Not allowing connection because onConnect callback returned null or falsey value`,
			);
			socket.close();
			return;
		}
	}

	let streamHeader;
	// Send magic bytes and video size to the newly connected socket
	// struct { char magic[4]; unsigned short width, height;}
	streamHeader = Buffer.alloc(8);
	streamHeader.write(STREAM_MAGIC_BYTES);
	streamHeader.writeUInt16BE(width, 4);
	streamHeader.writeUInt16BE(height, 6);
	socket.send(streamHeader, {
		binary: true,
	});

	console.log(
		`${name}: New WebSocket Connection (${wsServer.clients.size} total)`,
	);

	socket.remoteAddress = request.connection.remoteAddress;

	return socket.on('close', (code, message) => {
		return console.log(
			`${name}: Disconnected WebSocket (${wsServer.clients.size} total)`,
		);
	});
};

module.exports = VideoStream;
