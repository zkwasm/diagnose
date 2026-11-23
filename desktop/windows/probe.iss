[Setup]
AppId=Fenginwind.Diagnose.Probe
AppName=Diagnose Probe
AppVersion={#Version}
AppPublisher=Diagnose
MinVersion=10.0
DefaultDirName={localappdata}\Programs\Diagnose Probe
DefaultGroupName=Diagnose
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
OutputBaseFilename=Diagnose-Probe-Windows-x64
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\Diagnose Probe.exe
SetupIconFile={#ProbeIcon}
#ifdef SignProbe
SignTool=DiagnoseSign
SignedUninstaller=yes
#endif

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Diagnose Probe"; Filename: "{app}\Diagnose Probe.exe"
