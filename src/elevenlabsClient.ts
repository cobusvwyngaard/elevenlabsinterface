import type { TranscriptResponse } from "./types";

export const DEFAULT_API_URL = "https://api.elevenlabs.io/v1/speech-to-text";

export class ElevenLabsAPIError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details: unknown = null
  ) {
    super(message);
    this.name = "ElevenLabsAPIError";
  }
}

type Phase =
  | "connecting to ElevenLabs"
  | "uploading the file to ElevenLabs"
  | "waiting for ElevenLabs to return the completed transcript"
  | "communicating with ElevenLabs";

function timeoutMessage(phase: Phase, elapsedSeconds: number, note?: string): string {
  const base = `Timed out after about ${Math.round(elapsedSeconds)} seconds while ${phase}.`;
  return note ? `${base} ${note}` : base;
}

/** Digs a human-readable message out of the many shapes ElevenLabs uses for errors. */
function extractMessage(payload: unknown, depth = 0): string | null {
  if (depth > 5 || payload === null || payload === undefined) {
    return null;
  }
  if (typeof payload === "string") {
    return payload.trim() || null;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractMessage(item, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["detail", "message", "error"]) {
      if (key in record) {
        const found = extractMessage(record[key], depth + 1);
        if (found) {
          return found;
        }
      }
    }
  }
  return null;
}


/**
 * Assembles a multipart/form-data body that streams the audio rather than holding it.
 *
 * The exact length is computed up front so the request carries a Content-Length: a chunked
 * upload of this size is far more likely to be refused by an upstream.
 */
function buildStreamingMultipart(
  fields: [string, string][],
  file: { name: string; type: string; size: number; body: ReadableStream }
): { body: ReadableStream; contentType: string; contentLength: number } {
  const boundary = `----workbench${crypto.randomUUID().replace(/-/g, "")}`;
  const encoder = new TextEncoder();

  let preambleText = "";
  for (const [key, value] of fields) {
    preambleText += `--${boundary}\r\n`;
    preambleText += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
    preambleText += `${value}\r\n`;
  }
  preambleText += `--${boundary}\r\n`;
  preambleText += `Content-Disposition: form-data; name="file"; filename="${file.name.replace(/"/g, "")}"\r\n`;
  preambleText += `Content-Type: ${file.type}\r\n\r\n`;

  const preamble = encoder.encode(preambleText);
  const epilogue = encoder.encode(`\r\n--${boundary}--\r\n`);

  const reader = file.body.getReader();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(preamble);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(epilogue);
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: preamble.byteLength + file.size + epilogue.byteLength,
  };
}

export class ElevenLabsClient {
  private readonly apiUrl: string;
  /** Wall-clock ceiling per call. A Queue consumer invocation is capped anyway. */
  private readonly requestTimeoutMs: number;

  constructor(apiUrl: string = DEFAULT_API_URL, requestTimeoutMs = 13 * 60 * 1000) {
    this.apiUrl = apiUrl;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  private apiRoot(): string {
    const index = this.apiUrl.indexOf("/v1/");
    return index === -1 ? this.apiUrl : this.apiUrl.slice(0, index);
  }

  private async send(
    makeRequest: (signal: AbortSignal) => Request,
    apiKey: string,
    phase: Phase,
    options: { timeoutMs?: number; timeoutNote?: string; signal?: AbortSignal } = {}
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    // The Request is built once, with the abort signal already in it, and handed to fetch
    // untouched. Re-creating a Request, or passing an init as fetch's second argument, drops a
    // streaming body: the audio arrived at ElevenLabs as zero bytes.
    const request = makeRequest(controller.signal);
    request.headers.set("xi-api-key", apiKey);
    request.headers.set("accept", "application/json");

    try {
      return await fetch(request);
    } catch (error) {
      const elapsed = (Date.now() - startedAt) / 1000;
      if (controller.signal.aborted) {
        throw new ElevenLabsAPIError(504, timeoutMessage(phase, elapsed, options.timeoutNote));
      }
      throw new ElevenLabsAPIError(502, `Could not reach ElevenLabs: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
    let payload: unknown = null;
    let parsed = true;
    try {
      payload = await response.json();
    } catch {
      parsed = false;
    }

    if (!response.ok) {
      throw new ElevenLabsAPIError(response.status, extractMessage(payload) ?? fallbackMessage, payload);
    }
    if (!parsed) {
      throw new ElevenLabsAPIError(502, "ElevenLabs returned a response that was not valid JSON.");
    }
    return payload as T;
  }

  /**
   * Returns the raw response bytes. The transcript is never parsed here: on a Workers Free
   * invocation, JSON.parse of a long transcript would consume most of the 10ms CPU budget.
   */
  async transcribe(
    apiKey: string,
    fields: [string, string][],
    options: {
      enableLogging: boolean;
      file?: { name: string; type: string; size: number; body: ReadableStream };
      signal?: AbortSignal;
    }
  ): Promise<ArrayBuffer> {
    const url = new URL(this.apiUrl);
    url.searchParams.set("enable_logging", options.enableLogging ? "true" : "false");

    let makeRequest: (signal: AbortSignal) => Request;
    if (options.file) {
      // Built by hand and streamed: FormData would need the whole file in memory, which a
      // Worker cannot do. Sending it ourselves also means ElevenLabs never has to reach back
      // to us for the audio.
      const { body, contentType, contentLength } = buildStreamingMultipart(fields, options.file);
      makeRequest = (signal) =>
        new Request(url.toString(), {
          method: "POST",
          body,
          headers: { "content-type": contentType, "content-length": String(contentLength) },
          signal,
          // Required whenever the body is a stream; without it the body is silently empty.
          duplex: "half",
        } as RequestInit & { duplex: "half" });
    } else {
      const form = new FormData();
      for (const [key, value] of fields) {
        form.append(key, value);
      }
      makeRequest = (signal) => new Request(url.toString(), { method: "POST", body: form, signal });
    }

    const phase: Phase = options.file
      ? "uploading the file to ElevenLabs"
      : "waiting for ElevenLabs to return the completed transcript";

    const response = await this.send(makeRequest, apiKey, phase, {
      timeoutNote:
        "Do not simply retry: ElevenLabs may already have processed the audio and spent the credits.",
      signal: options.signal,
    });

    if (!response.ok) {
      // Error bodies are small, so parsing one costs nothing meaningful.
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        /* some upstream errors have no JSON body */
      }
      throw new ElevenLabsAPIError(
        response.status,
        extractMessage(payload) ?? "ElevenLabs rejected the transcription request.",
        payload
      );
    }

    return response.arrayBuffer();
  }

  async getSubscription(apiKey: string): Promise<Record<string, unknown>> {
    const response = await this.send(
      (signal) => new Request(`${this.apiRoot()}/v1/user/subscription`, { signal }),
      apiKey,
      "communicating with ElevenLabs",
      { timeoutMs: 30_000 }
    );
    return this.readJson(response, "ElevenLabs rejected the subscription request.");
  }

  async getUsageStats(
    apiKey: string,
    params: { startUnix: number; endUnix: number; aggregationInterval: string; metric: string; breakdownType: string }
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.apiRoot()}/v1/usage/character-stats`);
    url.searchParams.set("start_unix", String(params.startUnix));
    url.searchParams.set("end_unix", String(params.endUnix));
    url.searchParams.set("aggregation_interval", params.aggregationInterval);
    url.searchParams.set("metric", params.metric);
    url.searchParams.set("breakdown_type", params.breakdownType);

    const response = await this.send((signal) => new Request(url.toString(), { signal }), apiKey, "communicating with ElevenLabs", {
      timeoutMs: 30_000,
    });
    return this.readJson(response, "ElevenLabs rejected the usage request.");
  }

  async getTranscript(apiKey: string, transcriptionId: string): Promise<TranscriptResponse> {
    const response = await this.send(
      (signal) =>
        new Request(`${this.apiRoot()}/v1/speech-to-text/transcripts/${encodeURIComponent(transcriptionId)}`, {
          signal,
        }),
      apiKey,
      "communicating with ElevenLabs",
      { timeoutMs: 30_000 }
    );
    return this.readJson<TranscriptResponse>(response, "ElevenLabs rejected the transcript request.");
  }

  async deleteTranscript(apiKey: string, transcriptionId: string): Promise<void> {
    const response = await this.send(
      (signal) =>
        new Request(`${this.apiRoot()}/v1/speech-to-text/transcripts/${encodeURIComponent(transcriptionId)}`, {
          method: "DELETE",
          signal,
        }),
      apiKey,
      "communicating with ElevenLabs",
      { timeoutMs: 30_000 }
    );

    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        /* body is optional on delete */
      }
      throw new ElevenLabsAPIError(
        response.status,
        extractMessage(payload) ?? "ElevenLabs rejected the delete request.",
        payload
      );
    }
  }
}
