#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org then run this file again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
echo "Installing dependencies..."
npm install && echo "Building the app..." && npm run dist
if [ $? -ne 0 ]; then
  echo; echo "Build failed. You can still run the app directly with:  npm start"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
echo; echo "Done. The app is in dist/. Drag War Room.app to Applications."
open dist/mac* 2>/dev/null || open dist
