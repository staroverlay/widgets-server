import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const appsDir = join(__dirname, "..", "apps");

if (!existsSync(appsDir)) {
    console.log("apps directory does not exist, skipping build.");
    process.exit(0);
}

const apps = readdirSync(appsDir).filter(f => statSync(join(appsDir, f)).isDirectory());

for (const app of apps) {
    const appPath = join(appsDir, app);
    const pkgPath = join(appPath, "package.json");
    if (!existsSync(pkgPath)) continue;

    console.log(`\n============================================`);
    console.log(`📦 Building app: ${app}`);
    console.log(`============================================\n`);

    try {
        execSync("pnpm run build", { cwd: appPath, stdio: "inherit" });
    } catch (e) {
        console.error(`❌ Failed to build app: ${app}`);
        process.exit(1);
    }
}

console.log("\n✅ All apps built successfully!");
