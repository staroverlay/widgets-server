import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const rootDir = join(__dirname, "..", "..");
const appsDir = join(__dirname, "..", "apps");

try {
    console.log("============================================");
    console.log("🔄 Updating git submodules...");
    console.log("============================================\n");
    // Ensure all submodules are cloned/updated 
    execSync("git submodule update --init --recursive", { cwd: rootDir, stdio: "inherit" });
} catch (e) {
    console.warn("⚠️ Failed to update submodules. Continuing anyway.");
}

if (!existsSync(appsDir)) {
    console.log("Apps directory does not exist, skipping preinstall for widgets.");
    process.exit(0);
}

const apps = readdirSync(appsDir).filter(f => {
    // Avoid running on non-directories or empty directories
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
    console.log(`📦 Installing dependencies for app: ${app}`);
    console.log(`============================================\n`);

    try {
        execSync("bun install", { cwd: appPath, stdio: "inherit" });
    } catch (e) {
        console.error(`❌ Failed to install dependencies for app: ${app}`);
        process.exit(1);
    }
}

console.log("\n✅ All apps dependencies installed successfully!");
