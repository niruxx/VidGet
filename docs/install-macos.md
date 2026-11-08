# Installing Vidget on macOS

This guide works on Apple Silicon and Intel Macs running macOS 12 or newer.

## 1. Install Node.js and Git

With [Homebrew](https://brew.sh/):

```sh
brew install node git
node --version   # v20 or newer
```

## 2. Download Vidget

```sh
cd ~
git clone https://github.com/niruxx/VidGet.git vidget
cd vidget
npm ci
```

`npm ci` also downloads the ffmpeg and yt-dlp programs Vidget uses.

## 3. First run

```sh
npm start
```

The terminal shows the address and a one-time **setup token**. Open `http://localhost:3000/admin`, create the admin account with that token, and Vidget is then open at `http://localhost:3000`.

To use another port, start Vidget with `PORT=8080 npm start`, or change the port in `/admin` → **Server**.

## 4. Start Vidget automatically (launchd)

Create `~/Library/LaunchAgents/com.vidget.server.plist`. Replace `YOUR_USER` with your macOS username, and adjust the `node` path if `which node` prints something else (Intel Macs usually use `/usr/local/bin/node`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.vidget.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/YOUR_USER/vidget</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/YOUR_USER/vidget/logs/service.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOUR_USER/vidget/logs/service.log</string>
</dict>
</plist>
```

Then load it:

```sh
mkdir -p ~/vidget/logs
launchctl load ~/Library/LaunchAgents/com.vidget.server.plist
tail -f ~/vidget/logs/service.log   # the setup token appears here on first run
```

To restart after an update: `launchctl kickstart -k gui/$(id -u)/com.vidget.server`. To stop it for good: `launchctl unload ~/Library/LaunchAgents/com.vidget.server.plist`.

A LaunchAgent runs while you're logged in. To keep Vidget running with nobody logged in, put the plist in `/Library/LaunchDaemons/` instead and add a `UserName` key.

## 5. Updating

```sh
cd ~/vidget
git pull
npm ci
launchctl kickstart -k gui/$(id -u)/com.vidget.server
```

Your data (`data/`, `Saves/`, `logs/`, `tmp/`) isn't tracked by git and is left alone. yt-dlp keeps itself up to date once a day by default (`/admin` → **Media tools**).

## Hardware encoding

Every Mac since about 2017 can encode H.264 and H.265 in hardware with VideoToolbox. Turn on **Hardware video encoding** in `/admin` → **Media tools**. The status line confirms whether it works.

## Making it reachable from other devices

macOS may ask whether `node` may accept incoming connections. Allow it, or other devices on your network won't reach Vidget. For a public instance, use a reverse proxy with HTTPS. See [reverse-proxy.md](reverse-proxy.md).

## Troubleshooting

- **"Port 3000 is already in use".** Something else (often AirPlay Receiver on port 5000/7000, or another dev server) is using it. Pick another port.
- **Forgot the admin password.** Stop Vidget, delete `data/admin.json`, and start it again. Setup runs again with a new token.
