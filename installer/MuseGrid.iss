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
SetupIconFile=..\icon.ico
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


[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
