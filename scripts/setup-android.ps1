param([string]$ToolsRoot = "$env:LOCALAPPDATA\MyTranslateAndroid\tools")
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $ToolsRoot | Out-Null
# Versions/checksums from Google's repository2-1.xml. No Node native dependencies.
$packages = @(
  @{ Name='platform'; File='platform-35_r02.zip'; Sha1='0bb560a90a7a2cbd0dd8348224d518b638fe7949'; Probe='android-35\android.jar' },
  @{ Name='build-tools'; File='build-tools_r35_windows.zip'; Sha1='af059bb67cf7786f45ee0db85e2d24985df1b4b6'; Probe='android-15\aapt2.exe' },
  @{ Name='platform-tools'; File='platform-tools_r37.0.1-win.zip'; Sha1='e03e78b1d80b396f1c3358e31251cb31740e1110'; Probe='platform-tools\adb.exe' }
)
foreach ($package in $packages) {
  $destination = Join-Path $ToolsRoot $package.Name
  if (Test-Path -LiteralPath (Join-Path $destination $package.Probe)) { Write-Output "$($package.Name) already installed"; continue }
  $archive = Join-Path $ToolsRoot $package.File
  if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA1).Hash.ToLower() -ne $package.Sha1) {
    Invoke-WebRequest ('https://dl.google.com/android/repository/' + $package.File) -OutFile $archive
  }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA1).Hash.ToLower() -ne $package.Sha1) { throw 'Android SDK checksum mismatch' }
  Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
}
Write-Output 'Android SDK ready. JDK 17+, Node and pnpm are also required.'
