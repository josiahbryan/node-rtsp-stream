const child_process = require('child_process');
const util = require('util');
const events = require('events');

const Mpeg1Muxer = function ({
	inputStream,
	streamUrl: url,
	ffmpegOptions,
	ffmpegPath,
}) {
	Object.assign(this, {
		url,
		inputStream,
		ffmpegOptions,
		exitCode: undefined,
		additionalFlags: [],
	});

	if (ffmpegOptions) {
		for (let key in ffmpegOptions) {
			this.additionalFlags.push(key);

			if (String(ffmpegOptions[key]) !== '') {
				this.additionalFlags.push(String(ffmpegOptions[key]));
			}
		}
	}

	this.spawnOptions = [
		...(inputStream ? ['pipe:0'] : ['-rtsp_transport', 'tcp', '-i', this.url]),
		'-f',
		'mpegts',
		'-codec:v',
		'mpeg1video',
		// additional ffmpeg options go here
		...this.additionalFlags,
		'-',
	];

	this.stream = child_process.spawn(ffmpegPath, this.spawnOptions, {
		detached: false,
	});

	// Pipe input stream if any
	// Most of this is based on how fluent-ffmpeg handles stream piping
	if (inputStream) {
		inputStream.on('error', function (err) {
			const reportingErr = new Error(`Input stream error: ${err.message}`);
			this.emit(reportingErr);
			this.stream.kill();
		});

		inputStream.resume();
		inputStream.pipe(this.stream.stdin);

		// Set stdin error handler on ffmpeg (prevents nodejs catching the error, but
		// ffmpeg will fail anyway, so no need to actually handle anything)
		this.stream.stdin.on('error', function () {});
	}

	this.inputStreamStarted = true;

	this.stream.stdout.on('data', (data) => {
		return this.emit('mpeg1data', data);
	});

	this.stream.stderr.on('data', (data) => {
		return this.emit('ffmpegStderr', data);
	});

	this.stream.on('exit', (code, signal) => {
		if (code === 1) {
			console.error('RTSP stream exited with error');
			this.exitCode = 1;
			return this.emit('exitWithError');
		}
	});

	return this;
};

util.inherits(Mpeg1Muxer, events.EventEmitter);

module.exports = Mpeg1Muxer;
