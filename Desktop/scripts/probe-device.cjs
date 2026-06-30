const { SerialPort } = require("serialport");

const path = process.argv[2] || "COM7";
const commands = process.argv.slice(3);
if (!commands.length) commands.push("STATUS", "SESSIONS");

function command(name) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate: 921600, autoOpen: false });
    let pending = "";
    const timer = setTimeout(() => finish(new Error(`${name} timed out`)), 8000);
    let settled = false;
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const done = () => error ? reject(error) : resolve(value);
      if (port.isOpen) port.close(done); else done();
    }
    port.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        const responseType = name === "START" || name === "STOP" ? "STATUS" : name;
        const prefix = `@SPK ${responseType} `;
        if (line.startsWith(prefix)) {
          try { finish(null, JSON.parse(line.slice(prefix.length))); }
          catch { finish(new Error(`${name} returned invalid JSON`)); }
          return;
        }
        if (line.startsWith("@SPK ERROR ")) {
          finish(new Error(line.slice(11)));
          return;
        }
        if (line === "@SPK OK") {
          finish(null, { ok: true });
          return;
        }
        newline = pending.indexOf("\n");
      }
    });
    port.on("error", finish);
    port.open((error) => {
      if (error) return finish(error);
      setTimeout(() => port.write(`@SPK ${name}\n`), 250);
    });
  });
}

(async () => {
  const result = {};
  for (const name of commands) result[name.toLowerCase()] = await command(name);
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
