# Installing Vidget on Windows

This guide covers Windows 10 and 11. Commands are for **PowerShell**.

## 1. Install Node.js and Git

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close and reopen PowerShell so `node` and `git` are on your `PATH`, then check:

```powershell
node --version   # v20 or newer
git --version
```

## 2. Download Vidget

```powershell
cd $HOME
git clone https://github.com/niruxx/VidGet.git vidget
cd vidget
npm ci
```

`npm ci` also downloads the ffmpeg and yt-dlp programs Vidget uses. No separate install is needed.

## 3. First run

```powershell
npm start
```

The console shows the address and a one-time **setup token**:

```
Vidget running at http://localhost:3000

  First run: create the admin account to open Vidget to visitors.
  Open:        http://localhost:3000/admin
  Setup token: AbC123xYz789
```

Open `http://localhost:3000/admin` and create the admin account with that token. Vidget is then open to visitors at `http://localhost:3000`.

To change the port, set it in `/admin` → **Server**, or start Vidget with a different port:

```powershell
$env:PORT = 8080; npm start
```

## 4. Let other devices connect (optional)

Allow the port through Windows Firewall from an **administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Vidget" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

For a public instance, put Vidget behind a reverse proxy with HTTPS instead of exposing the port directly. See [reverse-proxy.md](reverse-proxy.md).

## 5. Run Vidget automatically (as a service)

The simplest reliable option is [NSSM](https://nssm.cc/), which runs any program as a Windows service.

```powershell
winget install NSSM.NSSM
```

Then, in an **administrator** PowerShell from the `vidget` folder:

```powershell
$node = (Get-Command node).Source
nssm install Vidget $node server.js
nssm set Vidget AppDirectory (Get-Location).Path
nssm set Vidget AppStdout (Join-Path (Get-Location) "logs\service.log")
nssm set Vidget AppStderr (Join-Path (Get-Location) "logs\service.log")
nssm set Vidget Start SERVICE_AUTO_START
New-Item -ItemType Directory -Force logs | Out-Null
nssm start Vidget
```

The setup token is then written to `logs\service.log` instead of the console.

Useful commands:

```powershell
nssm restart Vidget
nssm stop Vidget
nssm remove Vidget confirm
```

## 6. Updating

```powershell
cd $HOME\vidget
git pull
npm ci
nssm restart Vidget   # or stop and run npm start again
```

`git pull` keeps your settings: `data\`, `Saves\`, `logs\` and `tmp\` aren't tracked by git. If you edited `config.json` by hand, git may ask you to stash it first (`git stash`, `git pull`, `git stash pop`). Settings changed in `/admin` are saved to the same file.

yt-dlp updates itself once a day by default (`/admin` → **Media tools**), so you don't need to update Vidget just to keep downloads working.

## Hardware encoding

If the machine has an NVIDIA, Intel or AMD GPU, turn on **Hardware video encoding** in `/admin` → **Media tools**. That section shows which GPU encoder Vidget found and tested. Up-to-date graphics drivers are required.

## Troubleshooting

- **`npm ci` fails while downloading ffmpeg or yt-dlp.** A proxy or antivirus is probably blocking the download. Retry, or allow `node.exe` through.
- **"Port 3000 is already in use".** Pick another port (`$env:PORT = 3001`).
- **Forgot the admin password.** Stop Vidget, delete `data\admin.json`, and start it again. Setup runs again with a new token.
