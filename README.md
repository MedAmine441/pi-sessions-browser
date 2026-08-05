# 🌌 Pi Session Browser

> **Note:** This application is designed exclusively for people who use the **Pi coding agent on Linux**.

A stunning, high-performance interface designed for people using the Pi coding agent with Linux to browse and interact with their local Pi sessions. Built to handle thousands of sessions flawlessly with ultra-fast timeline parsing and native JSONL manipulation.

## ✨ Features

- **Ultra-Fast Timeline**: Extracts timestamps directly from filenames, rendering tens of thousands of session dates in milliseconds without parsing heavy `.jsonl` files.
- **True Real-Time Streaming**: Implements Server-Sent Events (SSE) instead of traditional polling. The UI reacts instantly to incoming AI messages with zero lag.
- **Native JSONL Manipulation**:
  - **In-App Creation**: Start a pristine new session directly from the browser; no terminal required.
  - **Session Renaming**: Dynamically rewrite the underlying `.jsonl` headers by simply clicking the title.
  - **Inline Message Editing**: Fix typos in past messages; the backend surgically rewrites historical lines inside the `.jsonl` file.
- **Dynamic Routing**: Clean URL architecture (`/[date]?session=[file]`) utilizing Next.js App Router for deep-linking and snappy transitions.
- **Cinematic UI**: Powered by Tailwind CSS, featuring glassmorphism, micro-animations, and a highly immersive ambient background canvas (Liquid & Embers).

## 🚀 Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Animations**: `tailwindcss-animate`, Custom WebGL/Canvas

## 🛠️ Getting Started

### 1. Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/medamine441/pi-sessions-browser.git
cd pi-sessions-browser
npm install
```

### 2. Configuration

The application automatically reads your Pi sessions from the default local directory:
`~/.pi/agent/sessions/--home-pc--`

_(Note: The root directory is managed in `src/lib/pi-sessions.ts`)_

### 3. Run the Development Server

Start the blazing-fast Turbopack dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the timeline.

### 4. Building the Desktop App (Electron)

You can build a standalone desktop version of the application using Electron:

```bash
# Build the application (Next.js standalone + Electron)
npm run electron:build
```

> **Customizing the App Icon**: The build will automatically use the icon file located at `build/icon.svg`. If you want to use your own icon (e.g. `.png`), simply place it in the `build/` folder, delete `icon.svg`, and update the `"icon"` field in the `package.json` build config before running the build command.

### 5. Creating a Desktop Shortcut

Follow these steps to properly integrate the AppImage into your Linux desktop:

On Linux, the build produces an `.AppImage` in the `dist/` folder. AppImages do not automatically add themselves to your application launcher. To make it appear in your app search and show the correct icon in your taskbar:

1. Create a file named `pi-sessions-browser.desktop` in `~/.local/share/applications/` with the following content (make sure to replace `/path/to/...` with your actual absolute paths):

```ini
[Desktop Entry]
Version=1.0
Type=Application
Name=Pi Session Browser
Comment=Pi Session Browser
Exec="/path/to/pi-sessions-browser/v2/dist/Pi Session Browser-0.1.0.AppImage" --no-sandbox
Icon=/path/to/pi-sessions-browser/v2/build/icon.svg
Terminal=false
Categories=Utility;
StartupWMClass=pi-sessions-browser
```

2. Make the file executable so your desktop environment recognizes it:

```bash
chmod +x ~/.local/share/applications/pi-sessions-browser.desktop
```

_(Optional)_: If you want a shortcut on your physical desktop as well, you can copy this file to your `~/Desktop/` folder.

## 📁 Project Architecture

- `src/app/page.tsx`: The root timeline, rendering the fast date aggregates.
- `src/app/[date]/page.tsx`: Dynamic routing for a specific date, lazy-loading heavy JSONL parsing.
- `src/components/ChatModal.tsx`: The core SSE chat interface for viewing, renaming, and editing sessions.
- `src/lib/pi-sessions.ts`: The Node.js FS backend engine for reading, modifying, and creating valid Pi `.jsonl` log files.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
Feel free to check out the [issues page](https://github.com/medamine441/pi-sessions-browser/issues).

## 📝 License

This project is [MIT](https://choosealicense.com/licenses/mit/) licensed.
