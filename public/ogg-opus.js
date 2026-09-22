// Minimal Ogg container writer for an Opus stream (RFC 7845).
//
// WebCodecs hands back raw Opus packets with no container, and ElevenLabs needs a file. Ogg is
// the canonical container for Opus and is unambiguously an audio file, where a .webm can be
// mistaken for video by a pipeline that only looks at the extension.

(function (global) {
  "use strict";

  // Ogg's CRC is a plain (non-reflected) CRC-32, polynomial 0x04c11db7, no initial or final xor.
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) {
        r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
      }
      table[i] = r >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) {
      crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
    }
    return crc >>> 0;
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  /** Granule positions exceed 32 bits on long recordings, so the high word is written separately. */
  function writeU64(view, offset, value) {
    const low = value >>> 0;
    const high = Math.floor(value / 4294967296) >>> 0;
    view.setUint32(offset, low, true);
    view.setUint32(offset + 4, high, true);
  }

  class OggOpusWriter {
    constructor(options) {
      this.serial = (Math.random() * 0xffffffff) >>> 0;
      this.sequence = 0;
      this.pages = [];
      this.pending = [];
      this.pendingBytes = 0;
      this.granule = 0;
      this.channels = options.channels ?? 1;
      this.preSkip = options.preSkip ?? 3840;
      this.inputRate = options.inputRate ?? 48000;
    }

    /** One Ogg page: header, lacing table, then the packet bodies it carries. */
    page(payloads, headerType, granule) {
      const laces = [];
      for (const payload of payloads) {
        let remaining = payload.length;
        while (remaining >= 255) {
          laces.push(255);
          remaining -= 255;
        }
        laces.push(remaining);
      }

      const bodyLength = payloads.reduce((sum, p) => sum + p.length, 0);
      const page = new Uint8Array(27 + laces.length + bodyLength);
      const view = new DataView(page.buffer);

      page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
      page[4] = 0;
      page[5] = headerType;
      writeU64(view, 6, granule);
      writeU32(view, 14, this.serial);
      writeU32(view, 18, this.sequence++);
      writeU32(view, 22, 0); // checksum, filled in below
      page[26] = laces.length;
      page.set(laces, 27);

      let offset = 27 + laces.length;
      for (const payload of payloads) {
        page.set(payload, offset);
        offset += payload.length;
      }

      // The checksum covers the whole page with its own field zeroed, which it already is.
      writeU32(view, 22, crc32(page));
      this.pages.push(page);
    }

    /** OpusHead and OpusTags each get a page of their own, as the spec requires. */
    writeHeaders(vendor = "elevenlabs-workbench") {
      const head = new Uint8Array(19);
      const headView = new DataView(head.buffer);
      head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
      head[8] = 1;
      head[9] = this.channels;
      headView.setUint16(10, this.preSkip, true);
      headView.setUint32(12, this.inputRate, true);
      headView.setUint16(16, 0, true); // output gain
      head[18] = 0; // channel mapping family 0
      this.page([head], 0x02, 0);

      const vendorBytes = new TextEncoder().encode(vendor);
      const tags = new Uint8Array(8 + 4 + vendorBytes.length + 4);
      const tagsView = new DataView(tags.buffer);
      tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); // "OpusTags"
      tagsView.setUint32(8, vendorBytes.length, true);
      tags.set(vendorBytes, 12);
      tagsView.setUint32(12 + vendorBytes.length, 0, true); // no user comments
      this.page([tags], 0x00, 0);
    }

    /**
     * Adds one Opus packet.
     *
     * `durationSamples` is counted at 48kHz whatever the input rate, because that is what an Ogg
     * granule position means for Opus.
     */
    addPacket(payload, durationSamples) {
      this.granule += durationSamples;
      this.pending.push(payload);
      this.pendingBytes += payload.length;

      // A page carries at most 255 lacing values, and packets this size need one each. Flushing
      // well short of that also keeps pages small enough to stay seekable.
      if (this.pending.length >= 50 || this.pendingBytes >= 32 * 1024) {
        this.flushPage(0x00);
      }
    }

    flushPage(headerType) {
      if (!this.pending.length) {
        return;
      }
      this.page(this.pending, headerType, this.granule);
      this.pending = [];
      this.pendingBytes = 0;
    }

    finish() {
      if (this.pending.length) {
        this.flushPage(0x04); // end of stream
      } else {
        this.page([new Uint8Array(0)], 0x04, this.granule);
      }
      return new Blob(this.pages, { type: "audio/ogg" });
    }
  }

  global.OggOpus = { OggOpusWriter, crc32 };
})(window);
