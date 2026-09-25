import { connect, type Socket } from "node:net";
import { createHash } from "node:crypto";
import tls from "node:tls";

export interface SmtpTarget {
  host: string;
  port: number;
  tlsMode: string;
  username: string;
  password: string;
  timeoutMs: number;
  heloName: string;
}

export class SmtpDeliveryError extends Error {
  readonly deliveryUncertain: boolean;

  constructor(message: string, deliveryUncertain: boolean) {
    super(message);
    this.deliveryUncertain = deliveryUncertain;
  }
}

export function plainConnection(host: string, port: number, timeoutMs: number) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect({ host, port, timeout: timeoutMs });
    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(message));
    };
    socket.once("error", (error: Error) => fail(error.message));
    socket.once("timeout", () => fail("Connection timed out"));
    socket.once("connect", () => resolve(socket));
  });
}

export function secureConnection(host: string, port: number, timeoutMs: number) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, timeout: timeoutMs });
    const fail = (message: string) => {
      socket.destroy();
      reject(new Error(message));
    };
    socket.once("error", (error: Error) => fail(error.message));
    socket.once("timeout", () => fail("Connection timed out"));
    socket.once("secureConnect", () => resolve(socket));
  });
}

/** Buffers protocol lines because TLS records can split a single reply. */
export class LineReader {
  private lines: string[] = [];
  private buffer = "";
  private error: Error | null = null;
  private wake: (() => void) | null = null;

  constructor(socket: Socket | tls.TLSSocket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        let line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        this.lines.push(line);
      }
      this.wake?.();
    });
    socket.once("error", (error: Error) => {
      this.error = error;
      this.wake?.();
    });
    socket.once("close", () => {
      this.error ??= new Error("The connection closed while waiting for an SMTP reply");
      this.wake?.();
    });
  }

  async readLine(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (this.lines.length === 0) {
      if (this.error) throw this.error;
      const wait = deadline - Date.now();
      if (wait <= 0) throw new Error("Timed out waiting for an SMTP reply");
      await new Promise<void>((resolveWake) => {
        this.wake = resolveWake;
        setTimeout(resolveWake, Math.min(wait, 250));
      });
      this.wake = null;
    }
    return this.lines.shift() as string;
  }
}

async function readReply(reader: LineReader, timeoutMs: number) {
  const first = await reader.readLine(timeoutMs);
  const match = /^(\d{3})([ -])(.*)$/.exec(first);
  if (!match) throw new Error(`The server sent an unexpected reply: ${first.slice(0, 200)}`);

  const code = match[1];
  let separator = match[2];
  const parts = [match[3]];
  while (separator === "-") {
    const line = await reader.readLine(timeoutMs);
    const continuation = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!continuation || continuation[1] !== code) {
      throw new Error(`The server sent an unexpected reply: ${line.slice(0, 200)}`);
    }
    separator = continuation[2];
    parts.push(continuation[3]);
  }
  return { code, text: parts.join("\n") };
}

async function command(
  reader: LineReader,
  socket: Socket | tls.TLSSocket,
  value: string,
  timeoutMs: number,
  accepted: (code: string) => boolean,
) {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${value}\r\n`, (error) => (error ? reject(error) : resolve()));
  });
  const reply = await readReply(reader, timeoutMs);
  if (!accepted(reply.code)) throw new Error(`The SMTP server rejected the request (${reply.code}).`);
  return reply;
}

function upgradeSocket(socket: Socket, host: string, timeoutMs: number) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const secure = tls.connect({ socket, servername: host });
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new Error("The TLS handshake timed out"));
    }, timeoutMs);
    secure.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(secure);
    });
    secure.once("error", (error: Error) => {
      clearTimeout(timer);
      reject(new Error(`The TLS handshake failed: ${error.message}`));
    });
  });
}

async function authenticate(reader: LineReader, socket: Socket | tls.TLSSocket, target: SmtpTarget) {
  await command(reader, socket, "AUTH LOGIN", target.timeoutMs, (code) => code === "334");
  await command(reader, socket, Buffer.from(target.username).toString("base64"), target.timeoutMs, (code) => code.startsWith("3"));
  await command(reader, socket, Buffer.from(target.password).toString("base64"), target.timeoutMs, (code) => code.startsWith("2"));
}

async function session<T>(target: SmtpTarget, run: (reader: LineReader, socket: Socket | tls.TLSSocket) => Promise<T>) {
  if (target.tlsMode !== "SSL" && target.tlsMode !== "STARTTLS" && target.tlsMode !== "NONE") {
    throw new Error("Invalid SMTP TLS mode");
  }
  const initial = target.tlsMode === "SSL"
    ? await secureConnection(target.host, target.port, target.timeoutMs)
    : await plainConnection(target.host, target.port, target.timeoutMs);
  let active: Socket | tls.TLSSocket = initial;
  let reader = new LineReader(active);

  try {
    const greeting = await readReply(reader, target.timeoutMs);
    if (greeting.code !== "220") throw new Error(`The server answered with an unexpected greeting (${greeting.code}).`);

    if (target.tlsMode === "STARTTLS") {
      const ehlo = await command(reader, active, `EHLO ${target.heloName}`, target.timeoutMs, (code) => code === "250");
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error("The server does not advertise STARTTLS.");
      await command(reader, active, "STARTTLS", target.timeoutMs, (code) => code === "220");
      active = await upgradeSocket(initial as Socket, target.host, target.timeoutMs);
      reader = new LineReader(active);
    }

    await command(reader, active, `EHLO ${target.heloName}`, target.timeoutMs, (code) => code === "250");
    await authenticate(reader, active, target);
    return await run(reader, active);
  } finally {
    active.destroy();
    if (active !== initial) initial.destroy();
  }
}

export async function probeSmtp(target: SmtpTarget) {
  try {
    await session(target, async (reader, socket) => {
      await command(reader, socket, "QUIT", target.timeoutMs, (code) => code === "221");
    });
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The SMTP connection failed." };
  }
}

function safeHeader(value: string) {
  if (!value || /[\r\n]/.test(value)) throw new Error("Invalid email header");
  return value;
}

function safeAddress(value: string) {
  const address = safeHeader(value);
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) throw new Error("Invalid email address");
  return address;
}

export interface SmtpMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  messageId?: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
  listUnsubscribe?: string;
}

export function formatSmtpMessage(message: SmtpMessage) {
  const from = safeAddress(message.from);
  const to = safeAddress(message.to);
  const subject = Buffer.from(safeHeader(message.subject), "utf8").toString("base64");
  const headers = [
    `From: <${from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${subject}?=`,
    ...(message.replyTo ? [`Reply-To: <${safeAddress(message.replyTo)}>`] : []),
    ...(message.messageId ? [`Message-ID: ${safeHeader(message.messageId)}`] : []),
    ...(message.inReplyTo ? [`In-Reply-To: ${safeHeader(message.inReplyTo)}`] : []),
    ...(message.references?.length ? [`References: ${message.references.map(safeHeader).join(" ")}`] : []),
    ...(message.listUnsubscribe ? [`List-Unsubscribe: <${safeHeader(message.listUnsubscribe)}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click"] : []),
    "MIME-Version: 1.0",
  ];
  if (!message.html) {
    const body = message.text.replace(/\r\n|\r|\n/g, "\r\n").replace(/^\./gm, "..");
    return [...headers, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", body, "."].join("\r\n");
  }

  const boundary = `cold-emailer-${createHash("sha256").update(message.text).update(message.html).digest("hex").slice(0, 24)}`;
  const body = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.html,
    `--${boundary}--`,
  ].join("\r\n").replace(/\r\n|\r|\n/g, "\r\n").replace(/^\./gm, "..");
  return [...headers, `Content-Type: multipart/alternative; boundary="${boundary}"`, "", body, "."].join("\r\n");
}

export async function sendSmtpEmail(
  target: SmtpTarget,
  message: SmtpMessage,
) {
  const from = safeAddress(message.from);
  const to = safeAddress(message.to);

  let deliveryStarted = false;
  try {
    await session(target, async (reader, socket) => {
      await command(reader, socket, `MAIL FROM:<${from}>`, target.timeoutMs, (code) => code.startsWith("2"));
      await command(reader, socket, `RCPT TO:<${to}>`, target.timeoutMs, (code) => code.startsWith("2"));
      await command(reader, socket, "DATA", target.timeoutMs, (code) => code === "354");
      deliveryStarted = true;
      await command(reader, socket, formatSmtpMessage(message), target.timeoutMs, (code) => code.startsWith("2"));
      socket.write("QUIT\r\n", () => undefined);
    });
  } catch (error) {
    throw new SmtpDeliveryError(error instanceof Error ? error.message : "SMTP delivery failed", deliveryStarted);
  }
}
