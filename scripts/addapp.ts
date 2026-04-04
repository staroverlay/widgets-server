import { execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const repoUrl = process.argv[2];
const appName = process.argv[3];

if (!repoUrl || !appName) {
    console.error("Usage: bun run scripts/addapp.ts <github-repo-url> <app-name>");
    process.exit(1);
}

const appsDir = join(__dirname, "..", "apps");
if (!existsSync(appsDir)) {
    mkdirSync(appsDir, { recursive: true });
}

console.log(`Adding ${repoUrl} as submodule to apps/${appName}...`);

try {
    execSync(`git submodule add ${repoUrl} apps/${appName}`, { stdio: "inherit" });

    const appPath = join(appsDir, appName);

    console.log(`\n============================================`);
    console.log(`📦 Installing dependencies for ${appName}...`);
    console.log(`============================================\n`);
    execSync("pnpm install", { cwd: appPath, stdio: "inherit" });

    console.log(`\n============================================`);
    console.log(`🛠️ Building ${appName}...`);
    console.log(`============================================\n`);
    execSync("pnpm run build", { cwd: appPath, stdio: "inherit" });

    console.log("\n✅ App added and built successfully!");

} catch (e) {
    console.error(`\n❌ Failed to add app ${appName}`, e);
    process.exit(1);
}
