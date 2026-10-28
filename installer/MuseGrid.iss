; ========================================================
; MuseGrid Native Inno Setup Script
; Bundles JUCE 8 Native Engine, AI Models (Demucs, Magenta),
; Monaco Editor, Audio DSP WASM, and VST3 Hosting Bridge
; ========================================================

#define MyAppName "MuseGrid"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "MuseGrid Audio Systems"
#define MyAppURL "https://github.com/ayushmishra/musegrid"
#define MyAppExeName "MuseGrid.exe"

[Setup]
AppId={{D37F2C5A-88B1-46B9-B3A9-4A7B2163E20F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\release
OutputBaseFilename=MuseGrid-Native-Setup-{#MyAppVersion}
SetupIconFile=..\assets\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Main Native Executable
Source: "..\bin\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\bin\icon.ico"; DestDir: "{app}"; Flags: ignoreversion

; Embedded Frontend, Monaco Editor, WASM Audio DSP, AI Models (Demucs, Magenta)
Source: "..\bin\dist\*"; DestDir: "{app}\dist"; Flags: ignoreversion recursesubdirs createallsubdirs

; Microsoft Edge WebView2 Offline Runtime Installer (extracted and run ONLY if WebView2 is missing on host PC)
Source: "..\assets\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; DestDir: "{tmp}"; Flags: ignoreversion; Check: not IsWebView2Installed


[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
; Install Microsoft Edge WebView2 Runtime silently if not present on the host PC
Filename: "{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "Configuring Microsoft Edge WebView2 Runtime..."; Flags: waituntilterminated; Check: not IsWebView2Installed

; Launch application after installation finishes
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
// Checks whether Microsoft Edge WebView2 Runtime is already installed on the system
function IsWebView2Installed: Boolean;
var
  Version: String;
begin
  // Check 64-bit and 32-bit registry hives for Edge WebView2 Runtime
  Result := RegQueryStringValue(HKEY_LOCAL_MACHINE,
    'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-23EC-450E-9488-0B3D800E08E1}', 'pv', Version) or
    RegQueryStringValue(HKEY_LOCAL_MACHINE,
    'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-23EC-450E-9488-0B3D800E08E1}', 'pv', Version) or
    RegQueryStringValue(HKEY_CURRENT_USER,
    'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-23EC-450E-9488-0B3D800E08E1}', 'pv', Version);

  if Result and (Version <> '') and (Version <> '0.0.0.0') then
    Result := True
  else
    Result := False;
end;
