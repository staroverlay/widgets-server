import { execSync } from "node:child_process";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";

const rootDir = join(__dirname, "..");
const appsDir = join(rootDir, "apps");

try {
    console.log("============================================");
    console.log("🧹 Cleaning submodules from disk...");
    console.log("============================================\n");

    // De-initialize submodules
    execSync("git submodule deinit -f --all", { cwd: rootDir, stdio: "inherit" });

    // Remove the git metadata to force a fresh clone
    const gitModulesDir = join(rootDir, ".git", "modules");
    if (existsSync(gitModulesDir)) {
        console.log("Removing .git/modules metadata...");
        rmSync(gitModulesDir, { recursive: true, force: true });
    }

    // Remove the actual files from disk
    if (existsSync(appsDir)) {
        console.log(`Removing physical files in ${appsDir}...`);
        rmSync(appsDir, { recursive: true, force: true });
    }

    console.log("\n============================================");
    console.log("🔄 Re-fetching submodules...");
    console.log("============================================\n");

    // Fetch and initialize the submodules from scratch
    execSync("git submodule update --init --recursive", { cwd: rootDir, stdio: "inherit" });

    console.log("\n✅ Submodules successfully cleaned and re-fetched!");
} catch (e) {
    console.error("❌ Failed to clean and re-fetch submodules:", e);
    process.exit(1);
}
