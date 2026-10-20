// Builds a ZIP archive in the browser.
//
// Written by hand rather than with a library because the browser already has the hard part:
// CompressionStream("deflate-raw") produces exactly the raw deflate stream ZIP's method 8 expects.
// What is left is the framing, which is a well-specified handful of little-endian records.

(function (global) {
  "use strict";

  // ZIP's CRC-32: reflected, polynomial 0xEDB88320, pre- and post-inverted.
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== "function") {
      return null;
    }
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Stored entries are still a valid archive, so a missing codec costs size and nothing else.
      return null;
    }
  }

  /** DOS date and time, which is what ZIP records rather than a sane timestamp. */
  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function writer(size) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    return {
      bytes,
      u16(value) {
        view.setUint16(offset, value, true);
        offset += 2;
      },
      u32(value) {
        view.setUint32(offset, value >>> 0, true);
        offset += 4;
      },
      raw(chunk) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      },
      get length() {
        return offset;
      },
    };
  }

  /**
   * Packs `files` into a ZIP blob.
   *
   * Each entry is `{ name, data }`, where data is a Uint8Array, a string, or a Blob. Names are
   * kept as given apart from path separators, which are stripped: a ZIP that writes outside the
   * folder it is extracted into is a real hazard, and nothing here needs directories.
   */
  async function build(files) {
    const encoder = new TextEncoder();
    const stamp = dosDateTime(new Date());
    const entries = [];
    let offset = 0;
    const chunks = [];

    for (const file of files) {
      const raw =
        file.data instanceof Uint8Array
          ? file.data
          : file.data instanceof Blob
            ? new Uint8Array(await file.data.arrayBuffer())
            : encoder.encode(String(file.data ?? ""));

      const name = encoder.encode(safeName(file.name));
      const crc = crc32(raw);
      const deflated = await deflateRaw(raw);
      // Only worth compressing if it actually came out smaller.
      const useDeflate = deflated !== null && deflated.length < raw.length;
      const body = useDeflate ? deflated : raw;

      const local = writer(30 + name.length);
      local.u32(0x04034b50);
      local.u16(20); // version needed
      local.u16(0x0800); // UTF-8 names
      local.u16(useDeflate ? 8 : 0);
      local.u16(stamp.time);
      local.u16(stamp.date);
      local.u32(crc);
      local.u32(body.length);
      local.u32(raw.length);
      local.u16(name.length);
      local.u16(0); // no extra field
      local.raw(name);

      chunks.push(local.bytes, body);
      entries.push({ name, crc, compressed: body.length, size: raw.length, offset, useDeflate });
      offset += local.bytes.length + body.length;
    }

    const directory = [];
    let directorySize = 0;
    for (const entry of entries) {
      const central = writer(46 + entry.name.length);
      central.u32(0x02014b50);
      central.u16(20); // made by
      central.u16(20); // version needed
      central.u16(0x0800);
      central.u16(entry.useDeflate ? 8 : 0);
      central.u16(stamp.time);
      central.u16(stamp.date);
      central.u32(entry.crc);
      central.u32(entry.compressed);
      central.u32(entry.size);
      central.u16(entry.name.length);
      central.u16(0); // extra
      central.u16(0); // comment
      central.u16(0); // disk number
      central.u16(0); // internal attributes
      central.u32(0); // external attributes
      central.u32(entry.offset);
      central.raw(entry.name);
      directory.push(central.bytes);
      directorySize += central.bytes.length;
    }

    const end = writer(22);
    end.u32(0x06054b50);
    end.u16(0); // this disk
    end.u16(0); // disk with the directory
    end.u16(entries.length);
    end.u16(entries.length);
    end.u32(directorySize);
    end.u32(offset);
    end.u16(0); // comment length

    return new Blob([...chunks, ...directory, end.bytes], { type: "application/zip" });
  }

  /** Keeps a name inside the archive: no directories, no traversal, nothing a file system refuses. */
  function safeName(name) {
    const flat = String(name || "file")
      .replace(/[\\/]+/g, "-")
      .replace(/[\x00-\x1f<>:"|?*]+/g, "-")
      .replace(/^\.+/, "")
      .trim();
    return flat || "file";
  }

  global.Zip = { build, crc32, safeName };
})(window);
