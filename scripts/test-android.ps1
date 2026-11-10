param([string]$Device = 'emulator-5558', [string]$Phase = 'full')
$ErrorActionPreference = 'Stop'
if (!$Device.StartsWith('emulator-')) { throw 'These checks may only run on a disposable emulator.' }
Set-Location (Split-Path $PSScriptRoot -Parent)
$tools = "$env:LOCALAPPDATA\MyTranslateAndroid\tools"
$bt = "$tools\build-tools\android-15"
$androidJar = "$tools\platform\android-35\android.jar"
$java = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { Split-Path (Split-Path (Get-Command javac.exe).Source -Parent) -Parent }
$work = Join-Path $env:TEMP ('opencode\android-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force "$work\classes", "$work\dex", "$work\assets", 'docs\qa-android' | Out-Null
function Run([string]$Executable, [string[]]$Arguments) { & $Executable @Arguments; if ($LASTEXITCODE) { throw "$Executable failed: $LASTEXITCODE" } }
Run "$bt\aapt2.exe" @('link', '-o', "$work\test.apk", '-I', $androidJar, '--manifest', 'android/tests/AndroidManifest.xml')
Run "$java\bin\keytool.exe" @('-J-Dkeystore.pkcs12.legacy','-genkeypair','-keystore',"$work\assets\model.p12",'-storetype','PKCS12','-storepass','test-only-password','-alias','model','-keyalg','RSA','-validity','2','-dname','CN=localhost','-ext','SAN=dns:localhost')
Run "$java\bin\jar.exe" @('uf', "$work\test.apk", '-C', $work, 'assets')
Run "$java\bin\javac.exe" @('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', $androidJar, '-d', "$work\classes", 'android/tests/SmokeTest.java', 'android/tests/MockModel.java')
Run "$java\bin\jar.exe" @('cf', "$work\test.jar", '-C', "$work\classes", '.')
Run "$java\bin\java.exe" @('-cp', "$bt\lib\d8.jar", 'com.android.tools.r8.D8', '--lib', $androidJar, '--min-api', '26', '--output', "$work\dex", "$work\test.jar")
Run "$java\bin\jar.exe" @('uf', "$work\test.apk", '-C', "$work\dex", 'classes.dex')
Run "$bt\zipalign.exe" @('-f', '4', "$work\test.apk", "$work\aligned.apk")
$secret = Get-Content "$env:LOCALAPPDATA\MyTranslateAndroid\signing\password.dpapi" | ConvertTo-SecureString
$env:MY_TRANSLATE_SIGN_PASSWORD = [Net.NetworkCredential]::new('', $secret).Password
try { Run "$java\bin\java.exe" @('-jar', "$bt\lib\apksigner.jar", 'sign', '--ks', "$env:LOCALAPPDATA\MyTranslateAndroid\signing\release.jks", '--ks-pass', 'env:MY_TRANSLATE_SIGN_PASSWORD', '--out', "$work\signed.apk", "$work\aligned.apk") }
finally { Remove-Item Env:\MY_TRANSLATE_SIGN_PASSWORD }
$adb = "$tools\platform-tools\platform-tools\adb.exe"
Run $adb @('-s', $Device, 'install', '--no-incremental', '-r', "$work\signed.apk")
$output = & $adb -s $Device shell am instrument -w -e phase $Phase com.mytranslate.mobile.tests/com.mytranslate.mobile.tests.SmokeTest
$output | Tee-Object -FilePath "docs/qa-android/$Device-$Phase.txt"
if ($Phase -in @('full','reload')) { Run $adb @('-s', $Device, 'pull', '/sdcard/Android/data/com.mytranslate.mobile/files', "docs/qa-android/$Device") }
if (($output -join "`n") -notmatch 'ANDROID_CHECKS_PASSED' -or ($output -join "`n") -match 'FAIL') { throw 'Android instrumentation failed' }
