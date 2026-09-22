// Re-encodes audio to Opus in the browser, so a recording too large to forward can be made to fit.
//
// Cloudflare will not let this app push more than 100 MiB to ElevenLabs in one request, and that
// limit is on the way through rather than anything to do with ElevenLabs. Speech re-encoded to
// mono Opus at 32-64 kbps is a fraction of the size of a phone recording and, per the published
// work on codec effects, sits in the range where word error rate is indistinguishable from the
// original.
//
// The browser's own codecs do the work. ffmpeg.wasm would be simpler but its core is 30.7 MB,
// above Cloudflare's 25 MiB limit for a single static asset, so it could not be served from here.

(function (global) {
  "use strict";

  const MP4_EXTENSIONS = /\.(m4a|m4b|mp4|mov|m4v|aac)$/i;
  const MP4_TYPES = /^(audio|video)\/(mp4|x-m4a|m4a|quicktime|aac)/i;

  // Above this, decoding the whole file into memory is not safe, so a demuxer is required.
  const WHOLE_FILE_DECODE_LIMIT = 64 * 1024 * 1024;

  /** Keeps the encoder fed without letting an unbounded queue accumulate in memory. */
  const MAX_QUEUE = 16;

  let mp4boxPromise = null;

  function loadMp4Box() {
    if (!mp4boxPromise) {
      mp4boxPromise = new Promise((resolve, reject) => {
        if (global.MP4Box) {
          resolve(global.MP4Box);
          return;
        }
        const tag = document.createElement("script");
        tag.src = "/vendor/mp4box.iife.js";
        tag.onload = () => (global.MP4Box ? resolve(global.MP4Box) : reject(new Error("MP4Box did not load.")));
        tag.onerror = () => reject(new Error("Could not load the MP4 reader."));
        document.head.appendChild(tag);
      });
    }
    return mp4boxPromise;
  }

  function isSupported() {
    return typeof global.AudioEncoder === "function" && typeof global.AudioDecoder === "function";
  }

  async function encoderAvailable(sampleRate, bitrate) {
    try {
      const support = await AudioEncoder.isConfigSupported({
        codec: "opus",
        sampleRate,
        numberOfChannels: 1,
        bitrate,
      });
      return support.supported === true;
    } catch {
      return false;
    }
  }

  function looksLikeMp4(file) {
    return MP4_EXTENSIONS.test(file.name) || MP4_TYPES.test(file.type || "");
  }

  /** Says whether this file can be compressed at all, and why not when it cannot. */
  function canCompress(file) {
    if (!isSupported()) {
      return { ok: false, reason: "This browser cannot re-encode audio. Chrome or Edge can." };
    }
    if (looksLikeMp4(file) || file.size <= WHOLE_FILE_DECODE_LIMIT) {
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        "Files this large can only be compressed from an MP4 container (.m4a, .mp4, .mov). " +
        "Convert the recording first, or upload it as it is.",
    };
  }

  function waitForDrain(target, property) {
    return new Promise((resolve) => {
      const check = () => (target[property] <= MAX_QUEUE ? resolve() : setTimeout(check, 4));
      check();
    });
  }

  /** Averages the channels into one, because speech gains nothing from stereo here. */
  function downmixToMono(audioData) {
    const frames = audioData.numberOfFrames;
    const channels = audioData.numberOfChannels;
    const mono = new Float32Array(frames);
    const plane = new Float32Array(frames);

    for (let channel = 0; channel < channels; channel++) {
      audioData.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
      for (let i = 0; i < frames; i++) {
        mono[i] += plane[i];
      }
    }
    if (channels > 1) {
      for (let i = 0; i < frames; i++) {
        mono[i] /= channels;
      }
    }
    return mono;
  }

  /** Reads pre-skip and channel count out of the OpusHead the encoder reports. */
  function readOpusHead(description) {
    if (!description) {
      return null;
    }
    const bytes = new Uint8Array(
      description instanceof ArrayBuffer ? description : description.buffer ?? description
    );
    if (bytes.length < 19) {
      return null;
    }
    const text = String.fromCharCode(...bytes.subarray(0, 8));
    if (text !== "OpusHead") {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { channels: bytes[9], preSkip: view.getUint16(10, true) };
  }

  /**
   * Drives one encoder from start to finish.
   *
   * The caller pushes mono Float32 frames through `push`; everything to do with packets, granule
   * positions and pages stays in here.
   */
  function createEncoderSink(sampleRate, bitrate) {
    const writer = new global.OggOpus.OggOpusWriter({
      channels: 1,
      inputRate: sampleRate,
    });
    let headersWritten = false;
    let packets = 0;

    const encoder = new AudioEncoder({
      output: (chunk, metadata) => {
        if (!headersWritten) {
          const head = readOpusHead(metadata?.decoderConfig?.description);
          if (head) {
            writer.channels = head.channels;
            writer.preSkip = head.preSkip;
          }
          writer.writeHeaders();
          headersWritten = true;
        }
        const payload = new Uint8Array(chunk.byteLength);
        chunk.copyTo(payload);
        // Granule positions for Opus are always counted at 48kHz, whatever went in.
        writer.addPacket(payload, Math.round((chunk.duration * 48000) / 1e6));
        packets++;
      },
      error: (error) => {
        sink.failure = error;
      },
    });

    encoder.configure({ codec: "opus", sampleRate, numberOfChannels: 1, bitrate });

    const sink = {
      encoder,
      failure: null,
      get packets() {
        return packets;
      },
      async finish() {
        await encoder.flush();
        encoder.close();
        if (!headersWritten) {
          throw new Error("The encoder produced no audio.");
        }
        return writer.finish();
      },
    };
    return sink;
  }

  function encodeMono(sink, mono, sampleRate, timestampUs) {
    const data = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: mono.length,
      numberOfChannels: 1,
      timestamp: timestampUs,
      data: mono,
    });
    sink.encoder.encode(data);
    data.close();
  }

  /**
   * Reads an MP4 through the demuxer and re-encodes it.
   *
   * The ordering here matters and is easy to get wrong: extraction has to be set up inside
   * onReady and the file flushed afterwards. Flushing first parses the index but delivers no
   * samples at all, which looks exactly like a file with no audio in it.
   */
  async function compressMp4(file, options) {
    const MP4Box = await loadMp4Box();
    const mp4 = MP4Box.createFile();

    const pending = [];
    let track = null;
    let failure = null;

    mp4.onError = (error) => {
      failure = new Error(`Could not read this MP4: ${error}`);
    };
    mp4.onReady = (info) => {
      track = info.tracks.find((candidate) => candidate.type === "audio" || candidate.audio);
      if (!track) {
        failure = new Error("This file has no audio track.");
        return;
      }
      mp4.setExtractionOptions(track.id, null, { nbSamples: 500 });
      mp4.start();
    };
    mp4.onSamples = (_id, _user, samples) => {
      for (const sample of samples) {
        pending.push(sample);
      }
    };

    options.buffer.fileStart = 0;
    mp4.appendBuffer(options.buffer);
    mp4.flush();

    if (failure) {
      throw failure;
    }
    if (!track) {
      throw new Error("This file could not be read as an MP4.");
    }
    if (!pending.length) {
      throw new Error("No audio samples could be read from this file.");
    }

    const trackInfo = mp4.getTrackById(track.id);
    const entry = trackInfo.mdia.minf.stbl.stsd.entries[0];
    // The decoder cannot start without the AudioSpecificConfig, which sits at the bottom of the
    // esds descriptor chain.
    const description = entry?.esds?.esd?.descs?.[0]?.descs?.[0]?.data;

    const sampleRate = track.audio?.sample_rate ?? entry?.samplerate ?? 48000;
    const channels = track.audio?.channel_count ?? entry?.channel_count ?? 2;
    const durationSeconds = track.duration / (track.timescale || 1);

    if (!(await encoderAvailable(sampleRate, options.bitrate))) {
      throw new Error("This browser cannot encode Opus at that sample rate.");
    }

    const sink = createEncoderSink(sampleRate, options.bitrate);
    let decodedFrames = 0;

    const decoder = new AudioDecoder({
      output: (audioData) => {
        try {
          const mono = downmixToMono(audioData);
          encodeMono(sink, mono, sampleRate, Math.round((decodedFrames / sampleRate) * 1e6));
          decodedFrames += audioData.numberOfFrames;
        } catch (error) {
          sink.failure = sink.failure ?? error;
        } finally {
          audioData.close();
        }
      },
      error: (error) => {
        sink.failure = sink.failure ?? error;
      },
    });

    decoder.configure({
      codec: track.codec || "mp4a.40.2",
      sampleRate,
      numberOfChannels: channels,
      ...(description ? { description } : {}),
    });

    for (let index = 0; index < pending.length; index++) {
      const sample = pending[index];
      if (options.signal?.aborted) {
        decoder.close();
        throw new DOMException("Cancelled.", "AbortError");
      }
      if (sink.failure) {
        decoder.close();
        throw sink.failure;
      }
      decoder.decode(
        new EncodedAudioChunk({
          type: sample.is_sync === false ? "delta" : "key",
          timestamp: (sample.cts / sample.timescale) * 1e6,
          duration: (sample.duration / sample.timescale) * 1e6,
          data: sample.data,
        })
      );
      // Released as we go, so a long recording does not hold every encoded frame at once.
      pending[index] = null;

      if (decoder.decodeQueueSize > MAX_QUEUE) {
        await waitForDrain(decoder, "decodeQueueSize");
      }
      if (sink.encoder.encodeQueueSize > MAX_QUEUE) {
        await waitForDrain(sink.encoder, "encodeQueueSize");
      }
      if (index % 200 === 0) {
        options.onProgress?.(index / pending.length);
      }
    }

    await decoder.flush();
    decoder.close();
    if (sink.failure) {
      throw sink.failure;
    }
    options.onProgress?.(1);
    return { blob: await sink.finish(), durationSeconds, sampleRate };
  }

  /** For formats without a demuxer here: let the browser decode the lot, then re-encode it. */
  async function compressWholeFile(file, options) {
    const context = new OfflineAudioContext(1, 1, 48000);
    let buffer;
    try {
      buffer = await context.decodeAudioData(options.buffer);
    } catch {
      throw new Error("This browser could not decode that audio format.");
    }

    const sampleRate = buffer.sampleRate;
    if (!(await encoderAvailable(sampleRate, options.bitrate))) {
      throw new Error("This browser cannot encode Opus at that sample rate.");
    }

    const sink = createEncoderSink(sampleRate, options.bitrate);
    const frames = buffer.length;
    const channels = buffer.numberOfChannels;
    const chunkFrames = Math.floor(sampleRate / 10); // 100ms at a time
    const planes = [];
    for (let channel = 0; channel < channels; channel++) {
      planes.push(buffer.getChannelData(channel));
    }

    for (let start = 0; start < frames; start += chunkFrames) {
      if (options.signal?.aborted) {
        throw new DOMException("Cancelled.", "AbortError");
      }
      if (sink.failure) {
        throw sink.failure;
      }
      const length = Math.min(chunkFrames, frames - start);
      const mono = new Float32Array(length);
      for (const plane of planes) {
        for (let i = 0; i < length; i++) {
          mono[i] += plane[start + i];
        }
      }
      if (channels > 1) {
        for (let i = 0; i < length; i++) {
          mono[i] /= channels;
        }
      }
      encodeMono(sink, mono, sampleRate, Math.round((start / sampleRate) * 1e6));
      if (sink.encoder.encodeQueueSize > MAX_QUEUE) {
        await waitForDrain(sink.encoder, "encodeQueueSize");
      }
      options.onProgress?.(Math.min(1, (start + length) / frames));
    }

    return { blob: await sink.finish(), durationSeconds: buffer.duration, sampleRate };
  }

  /**
   * Re-encodes `file` and hands back a File ready to upload.
   *
   * Returns the original untouched if compressing it would not actually help, so a already-small
   * recording is never degraded for nothing.
   */
  async function compress(file, { bitrate = 48000, onProgress, signal } = {}) {
    const permitted = canCompress(file);
    if (!permitted.ok) {
      throw new Error(permitted.reason);
    }

    const startedAt = Date.now();
    const buffer = await file.arrayBuffer();
    const options = { bitrate, onProgress, signal, buffer };

    const result = looksLikeMp4(file)
      ? await compressMp4(file, options)
      : await compressWholeFile(file, options);

    const name = file.name.replace(/\.[^.]+$/, "") + ".ogg";
    const compressed = new File([result.blob], name, { type: "audio/ogg" });

    return {
      file: compressed,
      originalBytes: file.size,
      compressedBytes: compressed.size,
      durationSeconds: result.durationSeconds,
      sampleRate: result.sampleRate,
      elapsedMs: Date.now() - startedAt,
    };
  }

  global.AudioCompressor = { isSupported, canCompress, compress };
})(window);
