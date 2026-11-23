# Build Diagnose Probe for Windows

Build on x64 Windows with the official x64 Node.js 22 distribution, Inno Setup 6 and the .NET Framework compiler. The build copies Node.js and installs dependencies from the repository lockfile. The installed app has its own runtime, installs per user and opens from the Start menu.

```powershell
npm.cmd ci
.\desktop\windows\build.ps1
```

This produces an unsigned test installer and SHA-256 checksum in `windows-installer`. For a release, pass a publisher-controlled signing command to `-SignCommand`. It must sign the quoted `$f` file provided by the build or installer compiler. The build verifies the installer's Authenticode signature. Keep signing credentials outside the repository and CI artifacts.

Open **Diagnose Probe**, select a language and choose **Start support**. The app stays in the foreground. Closing the window ends access. Test on a clean Windows computer with no Node.js or npm installed, then pair with a diagnostician and capture from a physical serial device before making a public installer available.
