import { execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

const rootDir = join(__dirname, "..");
const appsDir = join(__dirname, "..", "apps");

try {
    console.log("============================================");
    console.log("🔄 Pulling latest changes for git submodules...");
    console.log("============================================\n");

    // Using git submodule update --remote to fetch and update submodules to the latest commit
    execSync("git submodule update --remote --merge", { cwd: rootDir, stdio: "inherit" });
} catch (e) {
    console.warn("⚠️ Failed to update submodules. Ensure you have no uncommitted changes in them.");
}

if (!existsSync(appsDir)) {
    console.log("Apps directory does not exist, nothing more to do.");
    process.exit(0);
}

const apps = readdirSync(appsDir).filter(f => {
    try {
        return statSync(join(appsDir, f)).isDirectory();
    } catch {
        return false;
    }
});

for (const app of apps) {
    const appPath = join(appsDir, app);
    const pkgPath = join(appPath, "package.json");
    if (!existsSync(pkgPath)) continue;

    console.log(`\n============================================`);
    console.log(`📦 Installing dependencies and building app: ${app}`);
    console.log(`============================================\n`);

    try {
        execSync("bun install", { cwd: appPath, stdio: "inherit" });
        execSync("bun run build", { cwd: appPath, stdio: "inherit" });
    } catch (e) {
        console.error(`❌ Failed to process app: ${app}`);
    }
}

console.log("\n✅ All apps updated successfully!");
