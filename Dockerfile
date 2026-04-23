FROM oven/bun:1 AS base

# Install git and pnpm for submodule sync and app builds
RUN apt-get update && apt-get install -y git && npm install -g pnpm

WORKDIR /app

# In order to reach ../apps and run scripts correctly 
# the docker build context must be the root of the project.
COPY . .

WORKDIR /app/widgets-server

# Install widgets-server dependencies (and triggers preinstall.ts for apps)
RUN bun install

# Build the apps
RUN bun run build:apps

# Build the widgets server
RUN bun run build

# Default port
EXPOSE 3000

# Run in production
CMD ["bun", "run", "start"]
