/* eslint-disable camelcase */
/* eslint-disable no-console */
/* eslint-disable func-names */
const child_process = require('child_process');
const { EventEmitter } = require('events');

module.exports = class Mpeg1Muxer extends EventEmitter {
	constructor({ inputStream, streamUrl: url, ffmpegOptions, ffmpegPath }) {
		super();
		Object.assign(this, {
			url,
			inputStream,
			ffmpegOptions,
			exitCode: undefined,
			additionalFlags: [],
		});

		if (ffmpegOptions) {
			Object.entries(ffmpegOptions).forEach(([key, value]) => {
				this.additionalFlags.push(key);

				if (String(value) !== '') {
					this.additionalFlags.push(String(ffmpegOptions[key]));
				}
			});
		}

		this.spawnOptions = [
			...(inputStream
				? ['-f', 'mp4', '-i', 'pipe:0']
				: ['-rtsp_transport', 'tcp', '-i', this.url]),
			'-loglevel',
			'debug',
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

		this.stream.stdout.on('data', (data) => {
			if (!this.inputStreamStarted) {
				this.inputStreamStarted = true;
				this.emit('started');
			}

			this.emit('mpeg1data', data);
		});

		this.stream.stderr.on('data', (data) => {
			this.emit('ffmpegStderr', data);
		});

		this.stream.on('exit', (code /* signal */) => {
			if (code === 1) {
				console.error('RTSP stream exited with error');
				this.exitCode = 1;
				this.emit('exitWithError');
			}
			this.emit('end');
		});

		return this;
	}
};
