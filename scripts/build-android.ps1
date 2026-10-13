param(
  [string]$ToolsRoot = "$env:LOCALAPPDATA\MyTranslateAndroid\tools",
  [string]$JavaHome = $env:JAVA_HOME
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (!$JavaHome) { $JavaHome = Split-Path (Split-Path (Get-Command javac.exe).Source -Parent) -Parent }
$buildTools = Join-Path $ToolsRoot 'build-tools\android-15'
$androidJar = Join-Path $ToolsRoot 'platform\android-35\android.jar'
foreach ($required in @($androidJar, "$buildTools\aapt2.exe", "$JavaHome\bin\javac.exe")) {
  if (!(Test-Path -LiteralPath $required)) { throw "Missing tool: $required. See android/README.md." }
}
function Run-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}
Run-Checked 'node' @('scripts/build-android-web.cjs')
$version = (Get-Content -Raw -Encoding UTF8 package.json | ConvertFrom-Json).version
$build = [IO.Path]::GetFullPath((Join-Path (Get-Location) 'android\build'))
# Use a new build directory per invocation; never delete a computed directory.
$work = Join-Path $build ([Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force "$work\classes", "$work\dex", 'release\android' | Out-Null
$manifest = Get-Content -Raw -Encoding UTF8 android/app/src/main/AndroidManifest.xml
$manifest = $manifest -replace 'android:versionName="[^"]+"', "android:versionName=`"$version`""
[IO.File]::WriteAllText("$work\AndroidManifest.xml", $manifest)
Run-Checked "$buildTools\aapt2.exe" @('compile', '--dir', 'android/app/src/main/res', '-o', "$work\resources.zip")
Run-Checked "$buildTools\aapt2.exe" @('link', '-o', "$work\base.apk", '-I', $androidJar, '--manifest', "$work\AndroidManifest.xml", "$work\resources.zip")
# Windows aapt2 -A emits backslashes in nested asset names. jar uses APK-compatible / paths.
Run-Checked "$JavaHome\bin\jar.exe" @('uf', "$work\base.apk", '-C', 'android/app/src/main', 'assets')
$sources = @(Get-ChildItem -LiteralPath android/app/src/main/java -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
Run-Checked "$JavaHome\bin\javac.exe" (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', $androidJar, '-d', "$work\classes") + $sources)
Run-Checked "$JavaHome\bin\jar.exe" @('cf', "$work\classes.jar", '-C', "$work\classes", '.')
Run-Checked "$JavaHome\bin\java.exe" @('-cp', "$buildTools\lib\d8.jar", 'com.android.tools.r8.D8', '--lib', $androidJar, '--min-api', '26', '--output', "$work\dex", "$work\classes.jar")
Run-Checked "$JavaHome\bin\jar.exe" @('uf', "$work\base.apk", '-C', "$work\dex", 'classes.dex')
Run-Checked "$buildTools\zipalign.exe" @('-f', '-p', '4', "$work\base.apk", "$work\aligned.apk")
$signing = Join-Path $env:LOCALAPPDATA 'MyTranslateAndroid\signing'
New-Item -ItemType Directory -Force $signing | Out-Null
$keystore = Join-Path $signing 'release.jks'
$passwordFile = Join-Path $signing 'password.dpapi'
if (!(Test-Path -LiteralPath $keystore)) {
  if (Test-Path -LiteralPath $passwordFile) { throw 'Signing password exists but key is missing. Restore the original signing key before updating.' }
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
  $env:MY_TRANSLATE_SIGN_PASSWORD = [Convert]::ToBase64String($bytes)
  ConvertTo-SecureString $env:MY_TRANSLATE_SIGN_PASSWORD -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordFile
  Run-Checked "$JavaHome\bin\keytool.exe" @('-genkeypair', '-keystore', $keystore, '-storepass:env', 'MY_TRANSLATE_SIGN_PASSWORD', '-keypass:env', 'MY_TRANSLATE_SIGN_PASSWORD', '-alias', 'my-translate', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=My Translate Android, O=Personal, C=CN')
} else {
  $secret = Get-Content -LiteralPath $passwordFile | ConvertTo-SecureString
  $env:MY_TRANSLATE_SIGN_PASSWORD = [Net.NetworkCredential]::new('', $secret).Password
}
try {
  $apk = [IO.Path]::GetFullPath("release\android\My-Translate-$version.apk")
  Run-Checked "$JavaHome\bin\java.exe" @('-jar', "$buildTools\lib\apksigner.jar", 'sign', '--ks', $keystore, '--ks-key-alias', 'my-translate', '--ks-pass', 'env:MY_TRANSLATE_SIGN_PASSWORD', '--out', $apk, "$work\aligned.apk")
  Run-Checked "$JavaHome\bin\java.exe" @('-jar', "$buildTools\lib\apksigner.jar", 'verify', '--verbose', '--print-certs', $apk)
  $sha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLower()
  "$sha  $([IO.Path]::GetFileName($apk))" | Set-Content -Encoding ascii "release\android\SHA256SUMS.txt"
  Write-Output "APK: $apk"
} finally { Remove-Item Env:\MY_TRANSLATE_SIGN_PASSWORD -ErrorAction SilentlyContinue }
