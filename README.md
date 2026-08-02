# 🌌 Pi Session Browser

A stunning, high-performance web interface for browsing and interacting with your local Pi sessions. Built to handle thousands of sessions flawlessly with ultra-fast timeline parsing and native JSONL manipulation.

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
git clone https://github.com/yourusername/pi-session-browser.git
cd pi-session-browser
npm install
```

### 2. Configuration

The application automatically reads your Pi sessions from the default local directory:
`~/.pi/agent/sessions/--home-pc--`

*(Note: The root directory is managed in `src/lib/pi-sessions.ts`)*

### 3. Run the Development Server

Start the blazing-fast Turbopack dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the timeline.

## 📁 Project Architecture

- `src/app/page.tsx`: The root timeline, rendering the fast date aggregates.
- `src/app/[date]/page.tsx`: Dynamic routing for a specific date, lazy-loading heavy JSONL parsing.
- `src/components/ChatModal.tsx`: The core SSE chat interface for viewing, renaming, and editing sessions.
- `src/lib/pi-sessions.ts`: The Node.js FS backend engine for reading, modifying, and creating valid Pi `.jsonl` log files.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
Feel free to check out the [issues page](https://github.com/yourusername/pi-session-browser/issues).

## 📝 License

This project is [MIT](https://choosealicense.com/licenses/mit/) licensed.
