package com.mytranslate.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Local UI and isolated service WebViews. Only the service can access storage/network. */
public final class MainActivity extends Activity {
  private static final String ORIGIN = "https://appassets.androidplatform.net";
  private WebView ui, service;
  private TextView loading;
  private boolean ready, destroyed;
  private final ExecutorService network = Executors.newFixedThreadPool(4);
  private final Map<String, HttpsURLConnection> connections = new ConcurrentHashMap<>();
  private final Set<String> cancelled = ConcurrentHashMap.newKeySet();
  private final Map<String, Future<?>> jobs = new ConcurrentHashMap<>();
  private JSONObject exportRequest;
  private android.webkit.ValueCallback<Uri[]> corpusSelection;
  private SecretKey storageKey;

  private static JSONObject object(Object... pairs) {
    JSONObject result = new JSONObject();
    try { for (int i = 0; i < pairs.length; i += 2) result.put((String)pairs[i], pairs[i + 1]); }
    catch (Exception e) { throw new IllegalStateException(e); }
    return result;
  }
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setStatusBarColor(Color.rgb(32, 65, 61));
    getWindow().setNavigationBarColor(Color.rgb(32, 65, 61));
    LinearLayout layout = new LinearLayout(this);
    layout.setBackgroundColor(Color.rgb(32, 65, 61));
    layout.setOrientation(LinearLayout.VERTICAL);
    // API 35 enforces edge-to-edge; keep UI and IME clear of system bars.
    layout.setOnApplyWindowInsetsListener((view, insets) -> {
      view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
      return insets;
    });
    loading = new TextView(this);
    loading.setText("正在打开阅读空间…"); loading.setPadding(24, 40, 24, 24);
    layout.addView(loading);
    ui = createWebView(false);
    service = createWebView(true);
    layout.addView(ui, new LinearLayout.LayoutParams(-1, 0, 1));
    layout.addView(service, new LinearLayout.LayoutParams(1, 1));
    service.setVisibility(android.view.View.INVISIBLE);
    setContentView(layout);
    if (android.os.Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
      getWindow().getInsetsController().setSystemBarsAppearance(0,
        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
    }
    try { storageKey = loadKey(); service.loadUrl(ORIGIN + "/service/index.html"); }
    catch (Exception error) { showFatal("无法打开安全存储，原有数据已保留。"); }
  }
  private WebView createWebView(boolean backend) {
    WebView web = new WebView(this);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setSupportMultipleWindows(false);
    settings.setMediaPlaybackRequiresUserGesture(true);
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (backend || view != ui || corpusSelection != null) { callback.onReceiveValue(null); return true; }
        corpusSelection = callback;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
          .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/*", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/octet-stream"});
        try { startActivityForResult(intent, 11); }
        catch (android.content.ActivityNotFoundException e) { corpusSelection = null; callback.onReceiveValue(null); }
        return true;
      }
      @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
        if (!ready && message.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR) {
          android.util.Log.e("MyTranslateStartup", message.message());
          showFatal("页面初始化失败，请检查系统 WebView 版本。");
        }
        return true;
      }
    });
    web.setWebViewClient(new WebViewClient() {
      @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
        if (request.isForMainFrame()) showFatal("本地页面加载失败，错误代码 " + error.getErrorCode());
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl(); String route = uri.getPath();
        String prefix = backend ? "/service/" : "/ui/";
        if (!"https".equals(uri.getScheme()) || !"appassets.androidplatform.net".equals(uri.getHost()) || uri.getPort() != -1 || route == null || route.contains("..")) return blocked();
        String asset;
        if (backend && route.startsWith(prefix)) {
          asset = route.substring(1);
          android.content.pm.PackageInfo provider = WebView.getCurrentWebViewPackage();
          // Old vendor WebViews cannot compile WASM under strict CSP. Use sql.js's JS build.
          if (asset.equals("service/index.html") && provider != null) {
            try { if (Integer.parseInt(provider.versionName.split("\\.")[0]) < 100) asset = "service/legacy.html"; }
            catch (NumberFormatException ignored) { }
          }
        }
        else if (!backend && route.startsWith("/assets/")) asset = "ui" + route;
        else if (!backend && route.equals("/ui/android/index.html")) asset = "ui/android/index.html";
        else return blocked();
        try {
          String mime = asset.endsWith(".js") ? "text/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".wasm") ? "application/wasm" : "text/html";
          WebResourceResponse response = new WebResourceResponse(mime, "UTF-8", getAssets().open(asset));
          response.setResponseHeaders(Collections.singletonMap("X-Content-Type-Options", "nosniff"));
          return response;
        } catch (IOException error) { return blocked(); }
      }
    });
    if (backend) web.addJavascriptInterface(new ServiceBridge(), "AndroidHost");
    else web.addJavascriptInterface(new UiBridge(), "AndroidUI");
    return web;
  }
  private static WebResourceResponse blocked() {
    return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
  }
  private void evaluate(WebView view, String function, String json) {
    runOnUiThread(() -> { if (!destroyed) view.evaluateJavascript("window." + function + "(" + json + ")", null); });
  }
  private void showFatal(String message) {
    runOnUiThread(() -> { loading.setVisibility(android.view.View.VISIBLE); loading.setText("启动失败：" + message + "\n请尝试更新系统 WebView 后重新打开。请勿卸载或清除应用数据。"); });
  }
  public final class UiBridge {
    @JavascriptInterface public void post(String raw) {
      try {
        JSONObject request = new JSONObject(raw);
        if (raw.length() > 1024 * 1024 || !request.has("id") || !request.has("channel") || !request.has("args")) return;
        if (!ready) { evaluate(ui, "receiveHost", object("id", request.getString("id"), "error", "服务尚未就绪，请重试").toString()); return; }
        evaluate(service, "invokeService", request.toString());
      } catch (Exception ignored) { }
    }
    @JavascriptInterface public String clipboard(String operation, String value) {
      FutureTask<String> task = new FutureTask<>(() -> {
        ClipboardManager clipboard = (ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
        if ("write".equals(operation)) clipboard.setPrimaryClip(ClipData.newPlainText("译文", value));
        else if ("read".equals(operation)) {
          ClipData clip = clipboard.getPrimaryClip();
          return object("value", clip == null || clip.getItemCount() == 0 ? "" : clip.getItemAt(0).coerceToText(MainActivity.this).toString()).toString();
        } else return object("error", "无效剪贴板操作").toString();
        return "{}";
      });
      runOnUiThread(task);
      try { return task.get(5, TimeUnit.SECONDS); }
      catch (Exception e) { return object("error", "剪贴板暂不可用，请长按输入框粘贴").toString(); }
    }
  }
  private File storageFile(String name) {
    if (!name.equals("database") && !name.equals("settings")) throw new IllegalArgumentException("Invalid storage name");
    return new File(getFilesDir(), name + ".enc");
  }
  private SecretKey loadKey() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
    String alias = "my-translate-storage-v1";
    if (store.containsAlias(alias)) return (SecretKey)store.getKey(alias, null);
    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
    return generator.generateKey();
  }
  public final class ServiceBridge {
    @JavascriptInterface public synchronized String read(String name) {
      try {
        AtomicFile file = new AtomicFile(storageFile(name));
        byte[] encrypted;
        try { encrypted = file.readFully(); } catch (FileNotFoundException missing) { return object("value", JSONObject.NULL).toString(); }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, storageKey, new GCMParameterSpec(128, Arrays.copyOfRange(encrypted, 0, 12)));
        return object("value", new String(cipher.doFinal(encrypted, 12, encrypted.length - 12), StandardCharsets.UTF_8)).toString();
      } catch (Exception e) { return object("error", "本地数据读取失败，文件已保留").toString(); }
    }
    @JavascriptInterface public synchronized String write(String name, String value) {
      AtomicFile file = null; FileOutputStream output = null;
      try {
        file = new AtomicFile(storageFile(name));
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, storageKey);
        byte[] bytes = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        output = file.startWrite(); output.write(cipher.getIV()); output.write(bytes); file.finishWrite(output);
        return "{}";
      } catch (Exception e) { if (file != null && output != null) file.failWrite(output); return object("error", "本地保存失败，请检查剩余空间").toString(); }
    }
    @JavascriptInterface public String sha256(String value) {
      try {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(); for (byte b : bytes) hex.append(String.format(Locale.ROOT, "%02x", b & 255)); return hex.toString();
      } catch (Exception e) { throw new IllegalStateException(e); }
    }
    @JavascriptInterface public void post(String raw) {
      try {
        JSONObject message = new JSONObject(raw);
        if (message.optBoolean("ready")) {
          runOnUiThread(() -> { ready = true; loading.setVisibility(android.view.View.GONE); ui.loadUrl(ORIGIN + "/ui/android/index.html"); });
        } else if (message.has("fatal")) showFatal(message.getString("fatal"));
        else evaluate(ui, "receiveHost", message.toString());
      } catch (Exception ignored) { }
    }
    @JavascriptInterface public void request(String raw) {
      try {
        JSONObject request = new JSONObject(raw); String id = request.getString("id");
        FutureTask<Void> job = new FutureTask<>(() -> { performRequest(request); return null; });
        jobs.put(id, job); network.execute(job);
      } catch (Exception ignored) { }
    }
    @JavascriptInterface public void cancel(String id) {
      cancelled.add(id);
      HttpsURLConnection connection = connections.remove(id);
      // Cancellation must not queue behind four blocked network reads.
      if (connection != null) new Thread(connection::disconnect, "cancel-model-request").start();
      Future<?> job = jobs.remove(id); if (job != null) job.cancel(true);
    }
    @JavascriptInterface public void exportFile(String raw) {
      runOnUiThread(() -> {
        try {
          if (exportRequest != null) throw new IllegalStateException("导出正在进行");
          exportRequest = new JSONObject(raw);
          Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(exportRequest.getString("format").equals("csv") ? "text/csv" : "application/json")
            .putExtra(Intent.EXTRA_TITLE, exportRequest.getString("name"));
          startActivityForResult(intent, 10);
        } catch (Exception e) { exportRequest = null; evaluate(service, "receiveExport", object("status", "error", "message", "无法打开系统保存窗口").toString()); }
      });
    }
  }
  private void packet(String id, String type, Object... fields) {
    JSONObject packet = object("id", id, "type", type);
    try { for (int i = 0; i < fields.length; i += 2) packet.put((String)fields[i], fields[i + 1]); }
    catch (Exception e) { return; }
    if (!cancelled.contains(id)) evaluate(service, "receiveNetwork", packet.toString());
  }
  private void performRequest(JSONObject request) {
    String id = request.optString("id"); HttpsURLConnection connection = null;
    try {
      URL url = new URL(request.getString("url"));
      if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null) throw new IOException("模型地址必须使用 HTTPS");
      if (cancelled.contains(id)) return;
      connection = (HttpsURLConnection)url.openConnection(); connections.put(id, connection);
      connection.setInstanceFollowRedirects(false);
      connection.setConnectTimeout(15000); connection.setReadTimeout(120000);
      connection.setRequestMethod("POST"); connection.setDoOutput(true);
      JSONObject headers = request.getJSONObject("headers");
      Iterator<String> keys = headers.keys();
      while (keys.hasNext()) { String key = keys.next(); connection.setRequestProperty(key, headers.getString(key)); }
      connection.setRequestProperty("Accept-Encoding", "identity");
      byte[] body = request.getString("body").getBytes(StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(body.length);
      try (OutputStream output = connection.getOutputStream()) { output.write(body); }
      int status = connection.getResponseCode();
      if (status >= 300 && status < 400) throw new IOException("接口发生重定向，请直接填写最终 HTTPS 地址");
      packet(id, "headers", "status", status);
      InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
      if (input != null) try (InputStream stream = input) {
        byte[] buffer = new byte[8192]; int count; long total = 0;
        while (!cancelled.contains(id) && (count = stream.read(buffer)) != -1) {
          total += count; if (total > 16 * 1024 * 1024) throw new IOException("响应内容过大");
          packet(id, "chunk", "data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP));
        }
      }
      packet(id, "end");
    } catch (Exception e) {
      packet(id, "error", "message", e instanceof IOException && e.getMessage() != null && (e.getMessage().startsWith("模型地址") || e.getMessage().startsWith("接口发生") || e.getMessage().startsWith("响应内容")) ? e.getMessage() : "无法连接模型服务，请检查网络、HTTPS 地址和手机代理设置");
    } finally {
      if (connection != null) connection.disconnect(); connections.remove(id); jobs.remove(id); cancelled.remove(id);
    }
  }
  @Override protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (code == 11 && corpusSelection != null) {
      Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
      android.webkit.ValueCallback<Uri[]> callback = corpusSelection;
      corpusSelection = null;
      callback.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null);
      return;
    }
    if (code != 10 || exportRequest == null) return;
    JSONObject request = exportRequest; exportRequest = null;
    if (result != RESULT_OK || data == null || data.getData() == null) { evaluate(service, "receiveExport", object("status", "cancelled").toString()); return; }
    Uri uri = data.getData();
    network.execute(() -> {
      try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
        if (output == null) throw new IOException();
        output.write(request.getString("content").getBytes(StandardCharsets.UTF_8)); output.flush();
        evaluate(service, "receiveExport", object("status", "saved", "uri", uri.toString()).toString());
      } catch (Exception e) { evaluate(service, "receiveExport", object("status", "error", "message", "文件保存失败，请选择其他位置重试").toString()); }
    });
  }
  @Override protected void onPause() { if (ready) evaluate(service, "flushStorage", ""); super.onPause(); }
  @Override public void onBackPressed() {
    ui.evaluateJavascript("document.querySelector('[role=\"dialog\"]') !== null", result -> {
      if ("true".equals(result)) ui.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))", null);
      else new AlertDialog.Builder(this).setMessage("返回桌面？阅读记录已保存在本机。")
        .setPositiveButton("返回桌面", (dialog, which) -> moveTaskToBack(true)).setNegativeButton("继续阅读", null).show();
    });
  }
  @Override protected void onDestroy() {
    destroyed = true;
    for (HttpsURLConnection connection : connections.values()) connection.disconnect();
    network.shutdownNow(); ui.destroy(); service.destroy(); super.onDestroy();
  }
}
