import { spawnSync } from "node:child_process";

const steps = [
  ["vite build", "npm", ["run", "build"]]
];

for (const [label, cmd, args] of steps) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`Check failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log("All checks passed.");
