import { spawn } from "node:child_process";

const commands = [
  ["server", process.execPath, ["--watch", "server/index.js"]],
  ["client", process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173"]]
];

const children = commands.map(([name, cmd, args]) => {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" }
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      process.exitCode = code;
      for (const running of children) {
        if (running !== child) running.kill();
      }
    }
  });

  return child;
});

process.on("SIGINT", () => {
  for (const child of children) child.kill("SIGINT");
  process.exit();
});
