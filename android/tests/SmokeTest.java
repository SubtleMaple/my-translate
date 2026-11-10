package com.mytranslate.mobile.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.webkit.WebView;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Run only on a disposable emulator. Uses production APK, native bridges and real encrypted files. */
public final class SmokeTest extends Instrumentation {
  private Activity activity;
  private WebView ui, service;
  private String phase;
  private final StringBuilder report = new StringBuilder();
  @Override public void onCreate(Bundle args) { super.onCreate(args); phase = args == null ? "full" : args.getString("phase", "full"); start(); }
  private String evaluate(WebView web, String js) throws Exception {
    CountDownLatch latch = new CountDownLatch(1); String[] result = {null};
    runOnMainSync(() -> web.evaluateJavascript(js, value -> { result[0] = value; latch.countDown(); }));
    if (!latch.await(15, TimeUnit.SECONDS)) throw new Exception("JS timeout");
    return result[0];
  }
  private String async(String js) throws Exception {
    evaluate(ui, "window.__check=null;Promise.resolve().then(async()=>{" + js + "}).then(value=>window.__check={ok:true,value},error=>window.__check={ok:false,error:String(error)});");
    long deadline = System.currentTimeMillis() + 20000;
    while (System.currentTimeMillis() < deadline) {
      String result = evaluate(ui, "window.__check");
      if (!"null".equals(result)) { JSONObject value = new JSONObject(result); if (!value.getBoolean("ok")) throw new Exception(value.toString()); return value.optString("value"); }
      Thread.sleep(80);
    }
    throw new Exception("Async check timeout: " + js);
  }
  private void check(String name, String js) throws Exception { async(js); report.append("PASS ").append(name).append('\n'); }
  private void click(String name) throws Exception {
    evaluate(ui, "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===" + JSONObject.quote(name) + ").click()"); Thread.sleep(300);
    if (name.equals("生词本") || name.equals("设置") || name.equals("翻译") || name.equals("查词")) {
      String expected = name.equals("生词本") ? "生词本" : name.equals("设置") ? "你的阅读空间" : name.equals("查词") ? "一词，一次发现" : "读懂，再记住";
      check("navigate " + name, "for(let i=0;i<100&&document.querySelector('h1')?.textContent!=="+JSONObject.quote(expected)+";i++)await new Promise(r=>setTimeout(r,50));if(document.querySelector('h1')?.textContent!=="+JSONObject.quote(expected)+")throw Error('navigation');return true");
    }
  }
  private void recommendationsSettled(int remaining) throws Exception {
    async("for(let i=0;i<150;i++){const page=await api.getRecommendations({allowGenerate:false});if(page.remainingCount==="+remaining+"&&page.batchSize===10&&document.querySelectorAll('[data-recommendation-word]').length==="+Math.min(3,remaining)+"&&![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='取消推荐'))return true;await new Promise(r=>setTimeout(r,100));}throw Error('recommendations not ready: '+document.body.innerText)");
  }
  private void assertRecommendationGroup(String name, int remaining) throws Exception {
    recommendationsSettled(remaining);
    check(name, "const page=await api.getRecommendations();if(page.remainingCount!=="+remaining+"||page.batchSize!==10)throw Error('recommendation queue count changed');if(JSON.stringify(page.items.map(x=>x.id))!==JSON.stringify(window.__keptRecommendations.map(x=>x.id)))throw Error('recommendation ids changed');const words=[...document.querySelectorAll('[data-recommendation-word]')].map(e=>e.dataset.recommendationWord);if(JSON.stringify(words)!==JSON.stringify(window.__keptRecommendations.map(x=>x.word)))throw Error('recommendation cards changed');return true");
  }
  private void assertRecommendationConsumed(String name, int remaining) throws Exception {
    recommendationsSettled(remaining);
    check(name, "const before=window.__keptRecommendations;const page=await api.getRecommendations();if(page.remainingCount!=="+remaining+"||page.batchSize!==10)throw Error('queue consumption count');if(JSON.stringify(page.items.slice(0,2).map(x=>x.id))!==JSON.stringify(before.slice(1).map(x=>x.id)))throw Error('unconsumed cards changed order');window.__consumedIds.push(before[0].id);window.__firstBatchWords.push(before[0].word);if(page.items.some(x=>window.__consumedIds.includes(x.id)))throw Error('consumed candidate returned');window.__keptRecommendations=page.items;const words=[...document.querySelectorAll('[data-recommendation-word]')].map(e=>e.dataset.recommendationWord);if(JSON.stringify(words)!==JSON.stringify(page.items.map(x=>x.word)))throw Error('replacement cards differ');return true");
  }
  private void screenshot(String name) throws Exception {
    CountDownLatch painted = new CountDownLatch(1);
    runOnMainSync(() -> ui.postVisualStateCallback(0, new WebView.VisualStateCallback() { public void onComplete(long id) { painted.countDown(); } }));
    painted.await(5, TimeUnit.SECONDS);
    Thread.sleep(700);
    Bitmap bitmap = getUiAutomation().takeScreenshot();
    try (FileOutputStream output = new FileOutputStream(new File(getTargetContext().getExternalFilesDir(null), name + ".png"))) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); }
    bitmap.recycle();
  }
  private android.view.accessibility.AccessibilityNodeInfo waitPicker() throws Exception {
    long deadline = System.currentTimeMillis() + 15000;
    while (System.currentTimeMillis() < deadline) {
      android.view.accessibility.AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
      if (root != null && String.valueOf(root.getPackageName()).contains("documentsui")) return root;
      Thread.sleep(200);
    }
    throw new Exception("Document picker did not open");
  }
  private void importCorpusPdf() throws Exception {
    String name = "corpus-" + System.currentTimeMillis() + ".pdf";
    android.content.ContentValues values = new android.content.ContentValues();
    values.put("_display_name", name); values.put("mime_type", "application/pdf");
    android.content.ContentResolver resolver = getTargetContext().getContentResolver();
    android.net.Uri uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
    try {
      android.graphics.pdf.PdfDocument pdf = new android.graphics.pdf.PdfDocument();
      try (OutputStream output = resolver.openOutputStream(uri)) {
        android.graphics.pdf.PdfDocument.Page page = pdf.startPage(new android.graphics.pdf.PdfDocument.PageInfo.Builder(240, 80, 1).create());
        page.getCanvas().drawText("gravity gravity", 10, 40, new android.graphics.Paint());
        pdf.finishPage(page); pdf.writeTo(output);
      } finally { pdf.close(); }
      click("查词");
      if ("corpus-ai".equals(phase)) {
        check("select AI corpus screening", "const s=document.querySelector('select');s.value='ai';s.dispatchEvent(new Event('change',{bubbles:true}));for(let i=0;i<50;i++){if((await api.getRecommendations({allowGenerate:false})).corpusMode==='ai')return true;await new Promise(r=>setTimeout(r,100))}throw Error('mode')");
      }
      // Exercise the granted content URI directly on older system picker versions too.
      android.content.IntentFilter filter = new android.content.IntentFilter(Intent.ACTION_OPEN_DOCUMENT);
      filter.addCategory(Intent.CATEGORY_OPENABLE);
      filter.addDataType("*/*");
      ActivityMonitor provider = "corpus-provider".equals(phase)
        ? addMonitor(filter, new ActivityResult(Activity.RESULT_OK, new Intent().setData(uri)), true) : null;
      // Use a real tap so the WebView grants the file chooser a user gesture.
      String coordinates = async("const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('导入语料'));b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return JSON.stringify([(r.x+r.width/2)*devicePixelRatio,(r.y+r.height/2)*devicePixelRatio])");
      org.json.JSONArray point = new org.json.JSONArray(coordinates);
      int[] offset = new int[2]; runOnMainSync(() -> ui.getLocationOnScreen(offset));
      long time = android.os.SystemClock.uptimeMillis();
      for (int action : new int[]{0,1}) {
        android.view.MotionEvent event = android.view.MotionEvent.obtain(time, android.os.SystemClock.uptimeMillis(), action, offset[0]+(float)point.getDouble(0), offset[1]+(float)point.getDouble(1), 0);
        event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN); sendPointerSync(event); event.recycle();
      }
      if (provider == null) selectCorpusDocument(name);
      else {
        for (int i=0;i<40 && provider.getHits()==0;i++) Thread.sleep(100);
        removeMonitor(provider);
        if (provider.getHits() != 1) throw new Exception("Document picker not invoked");
      }
      if ("corpus-ai".equals(phase)) {
        check("word review progress", "for(let i=0;i<100;i++){if(document.querySelector('progress'))return true;await new Promise(r=>setTimeout(r,50))}throw Error(document.body.innerText)");
      }
      check("PDF import and local batch", "for(let i=0;i<120;i++){const err=document.querySelector('[role=alert]');if(err)throw Error(err.innerText);const p=await api.getRecommendations({allowGenerate:false});if(p.corpusCount){const next=await api.getRecommendations({action:'refresh'});if(!next.items.some(x=>x.source==='corpus'&&x.word==='gravity'))throw Error('wrong PDF word');return true}if(p.items.some(x=>x.source==='corpus'&&x.word==='gravity'))return true;await new Promise(r=>setTimeout(r,100))}throw Error(document.body.innerText)");
      click("翻译"); click("查词");
      if ("corpus-ai".equals(phase)) {
        check("open preview", "document.querySelector('[aria-label=预览语料词]').click();await new Promise(r=>setTimeout(r,200));const d=document.querySelector('[role=dialog]');if(!d?.innerText.includes('gravity'))throw Error('preview');[...d.querySelectorAll('button')].find(b=>b.textContent==='关闭').click();return true");
        check("detail on tap", "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='查询推荐词 gravity').click();for(let i=0;i<100;i++){if(document.querySelector('article h2')?.textContent==='gravity')return true;await new Promise(r=>setTimeout(r,100))}throw Error(document.body.innerText)");
        return;
      }
      check("preview and remove imported word",
        "const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label);" +
        "const wait=async f=>{for(let i=0;i<80;i++){if(f())return;await new Promise(r=>setTimeout(r,80))}throw Error('preview did not update')};" +
        "await wait(()=>button('预览语料词'));button('预览语料词').click();await wait(()=>button('删除语料词 gravity'));" +
        "button('删除语料词 gravity').click();await wait(()=>!button('删除语料词 gravity'));" +
        "const p=await api.getRecommendations({allowGenerate:false});if([...p.corpusPreview.batch,...p.corpusPreview.pending].includes('gravity'))throw Error('removed word returned');return true");
    } finally { resolver.delete(uri, null, null); }
  }
  private void reviewExistingWords() throws Exception {
    check("import local corpus", "await api.importCorpus([{word:'gravity',count:2},{word:'timber',count:1}],'local');return true");
    click("查词");
        check("screen local candidates and bulk delete in preview",
          "const wait=async f=>{for(let i=0;i<120;i++){if(f())return;await new Promise(r=>setTimeout(r,80))}throw Error(document.body.innerText)};" +
          "document.querySelector('[aria-label=预览语料词]').click();const dialog=()=>document.querySelector('[role=dialog]');" +
          "const button=text=>[...dialog().querySelectorAll('button')].find(b=>b.textContent.includes(text));" +
          "await wait(()=>dialog()&&button('AI 精筛全部'));button('AI 精筛全部').click();await wait(()=>dialog().querySelector('progress'));" +
          "await wait(()=>dialog().innerText.includes('1 个词的审校结果无效'));dialog().querySelector('[aria-label=全选所有页]').click();" +
          "await wait(()=>button('删除所选（2）'));button('删除所选（2）').click();await wait(()=>dialog().innerText.includes('暂无待推荐'));return true");
  }
  private void selectCorpusDocument(String name) throws Exception {
    waitPicker(); Thread.sleep(650);
    boolean opened = false;
    for (int i=0;i<30 && !opened;i++) {
      android.view.accessibility.AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
      if (root != null) for (android.view.accessibility.AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText(name)) {
        if (!name.contentEquals(node.getText() == null ? "" : node.getText())) continue;
        android.graphics.Rect bounds = new android.graphics.Rect();
        node.getBoundsInScreen(bounds);
        if (bounds.isEmpty()) continue;
        try (InputStream shell = new android.os.ParcelFileDescriptor.AutoCloseInputStream(
            getUiAutomation().executeShellCommand("input tap " + bounds.centerX() + " " + bounds.centerY()))) {
          while (shell.read() != -1) { /* Wait for the system tap. */ }
        }
        opened = true; break;
      }
      if (!opened) Thread.sleep(200);
    }
    if (!opened) throw new Exception("PDF missing from system picker");
  }
  @Override public void onStart() {
    Bundle results = new Bundle();
    try {
      activity = startActivitySync(new Intent().setClassName("com.mytranslate.mobile", "com.mytranslate.mobile.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      Field uiField = activity.getClass().getDeclaredField("ui"), serviceField = activity.getClass().getDeclaredField("service");
      uiField.setAccessible(true); serviceField.setAccessible(true); ui = (WebView)uiField.get(activity); service = (WebView)serviceField.get(activity);
      long deadline = System.currentTimeMillis() + 45000;
      while (!"true".equals(evaluate(ui, "!!document.querySelector('#source-text')"))) { if (System.currentTimeMillis() > deadline) throw new Exception("App startup: " + evaluate(service, "document.body.innerText")); Thread.sleep(150); }
      check("native API and viewport", "if(window.api.platform!=='android')throw Error('platform');if(document.documentElement.scrollWidth>innerWidth+1)throw Error('overflow');return true");
      if ("corpus-ai".equals(phase) || "corpus-preview".equals(phase)) {
        try (MockModel model = new MockModel(getContext())) {
          evaluate(ui, "window.__modelUrl="+JSONObject.quote(model.url()));
          check("configure isolated model", "await api.setSettings({llm:{type:'openai',openai:{baseURL:window.__modelUrl,apiKey:'synthetic-test-only',model:'android-test',thinking:'off'}}});return true");
          if ("corpus-preview".equals(phase)) reviewExistingWords(); else importCorpusPdf();
          if (model.corpusRequests!=1 || model.requests!=("corpus-preview".equals(phase)?1:3)) throw new Exception("unexpected model calls: "+model.requests);
        }
      } else if ("corpus".equals(phase) || "corpus-provider".equals(phase)) {
        importCorpusPdf();
      } else if ("reload".equals(phase)) {
        check("encrypted settings, vocabulary and review survive process restart", "const s=await api.getSettings();const v=await api.listVocab({});if(s.llm.openai.model!=='android-test'||!v.some(x=>x.note==='Android persistent note'))throw Error('lost data');const o=await api.reviewOverview();if(!o)throw Error('lost review');return true");
        File expected = new File(getTargetContext().getExternalFilesDir(null), "test-recommendation-ids.json");
        byte[] bytes = new byte[(int)expected.length()];
        try (DataInputStream input = new DataInputStream(new FileInputStream(expected))) { input.readFully(bytes); }
        evaluate(ui, "window.__expectedRecommendations=" + new String(bytes, StandardCharsets.UTF_8));
        click("查词"); recommendationsSettled(9);
        check("recommendation queue, ids and order survive process restart", "const page=await api.getRecommendations();const expected=window.__expectedRecommendations;if(page.remainingCount!==expected.remainingCount||page.batchSize!==expected.batchSize)throw Error('lost queue count');if(JSON.stringify(page.items.map(x=>x.id))!==JSON.stringify(expected.ids))throw Error('lost recommendation group');const words=[...document.querySelectorAll('[data-recommendation-word]')].map(e=>e.dataset.recommendationWord);if(JSON.stringify(words)!==JSON.stringify(page.items.map(x=>x.word)))throw Error('reloaded cards differ');return true");
      } else {
        if ("true".equals(evaluate(ui,"document.documentElement.classList.contains('dark')"))) evaluate(ui,"document.querySelector('button[title=\"切换深浅色\"]').click()");
        screenshot("translate-light");
        check("reject cleartext network", "await api.setSettings({llm:{type:'openai',openai:{baseURL:'http://example.invalid/v1',apiKey:'synthetic-test-only',model:'android-test',thinking:'off'}}});const result=await api.testConnection();if(result.ok||!result.message.includes('HTTPS'))throw Error(JSON.stringify(result));return true");
        MockModel model = new MockModel(getContext());
        evaluate(ui, "window.__modelUrl="+JSONObject.quote(model.url()));
        check("OpenAI and Anthropic translation through UI RPC", "for(const type of ['openai','anthropic']){await api.setSettings({llm:{type,[type]:{baseURL:window.__modelUrl,apiKey:'synthetic-test-only',model:'android-test',thinking:'off'}}});await new Promise(async(resolve,reject)=>{const id=crypto.randomUUID();let text='';const off=api.onTranslateEvent(e=>{if(e.requestId!==id)return;if(e.type==='chunk')text+=e.delta;if(e.type==='error'){off();reject(Error(e.message))}if(e.type==='done'){off();text==='你好，世界。'?resolve():reject(Error('bad stream'))}});await api.translate(id,'Hello world');});}return true");
        check("lookup and save normalized word", "const result=await api.lookupWord('android-lookup','books');if(result.word!=='book')throw Error('normalize');await api.saveLookup(result.id);const words=await api.listVocab({});if(words[0].status!=='ready')throw Error('detail');await api.updateVocabNote(words[0].id,'Android persistent note');return true");
        check("real FSRS review, rating, undo and rerating", "let s=await api.startReview({mode:'random',size:1});const cmd=()=>({sessionId:s.id,questionId:s.question.id,revision:s.revision});s=await api.revealReview(cmd());s=await api.rateReview(cmd(),3);s=await api.undoReview(s.id,s.revision);s=await api.revealReview(cmd());s=await api.rateReview(cmd(),3);return true");
        click("查词"); recommendationsSettled(10);
        check("ten candidates with three visible through native TLS", "const page=await api.getRecommendations({allowGenerate:false});window.__keptRecommendations=page.items;window.__consumedIds=[];window.__firstBatchWords=[];if(page.items.length!==3||page.remainingCount!==10||page.batchSize!==10)throw Error('initial recommendation queue count');window.__lookupTarget=page.items[0];return true");
        if (model.recommendationRequests.get()!=1 || model.analysisRequests.get()!=1) throw new Exception("First group did not make exactly one analysis and recommendation request");
        int recommendationCalls = model.recommendationRequests.get(), analysisCalls = model.analysisRequests.get();
        evaluate(ui, "document.querySelector('[aria-label=\"查询推荐词 '+window.__lookupTarget.word+'\"]').click()");
        check("lookup recommended word", "for(let i=0;i<100&&document.querySelector('article h2')?.textContent!==window.__lookupTarget.word;i++)await new Promise(r=>setTimeout(r,100));if(document.querySelector('article h2')?.textContent!==window.__lookupTarget.word)throw Error('recommended lookup');return true");
        check("successful lookup consumes one candidate before saving", "const page=await api.getRecommendations({allowGenerate:false});if(page.remainingCount!==9||page.batchSize!==10)throw Error('lookup did not consume once');if(JSON.stringify(page.items.slice(0,2).map(x=>x.id))!==JSON.stringify(window.__keptRecommendations.slice(1).map(x=>x.id)))throw Error('lookup reordered unconsumed cards');return true");
        click("加入生词本");
        check("save recommended word", "for(let i=0;i<100;i++){if((await api.listVocab({})).some(e=>e.word===window.__lookupTarget.word))return true;await new Promise(r=>setTimeout(r,100));}throw Error('recommended word not saved')");
        evaluate(ui, "const input=document.querySelector('input[aria-label=\"查询英文单词\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));");
        assertRecommendationConsumed("lookup fills from same batch and saving does not consume twice",9);
        evaluate(ui, "window.__knownWord=window.__keptRecommendations[0].word;document.querySelector('[aria-label=\"已认识 '+window.__knownWord+'\"]').click()");
        assertRecommendationConsumed("known feedback consumes one and fills from same batch",8);
        check("known feedback recorded", "const page=await api.getRecommendations({allowGenerate:false});if(!page.feedback.some(x=>x.word===window.__knownWord&&x.kind==='known'))throw Error('known feedback missing');return true");
        evaluate(ui, "window.__skippedWord=window.__keptRecommendations[0].word;document.querySelector('[aria-label=\"不感兴趣 '+window.__skippedWord+'\"]').click()");
        assertRecommendationConsumed("skip feedback consumes one and fills from same batch",7);
        check("skip feedback recorded", "const page=await api.getRecommendations({allowGenerate:false});if(!page.feedback.some(x=>x.word===window.__skippedWord&&x.kind==='skip'))throw Error('skip feedback missing');return true");
        click("偏简单"); assertRecommendationGroup("difficulty change retains current candidate queue",7);
        check("difficulty preference recorded for next refresh", "const page=await api.getRecommendations({allowGenerate:false});if(page.targetLevel!=='B2'||page.adjustment!==1)throw Error('difficulty preference missing');return true");
        click("翻译"); click("查词"); assertRecommendationGroup("navigation retains current candidate queue",7);
        if (model.recommendationRequests.get()!=recommendationCalls || model.analysisRequests.get()!=analysisCalls) throw new Exception("Lookup, save, feedback, preference or navigation generated new recommendations");
        check("consume all ten candidates without replacing hidden queue", "let page=await api.getRecommendations();for(let remaining=7;remaining>0;remaining--){if(page.remainingCount!==remaining||page.items.length!==Math.min(3,remaining))throw Error('remaining queue count');const before=page.items;const candidate=before[0];if(window.__consumedIds.includes(candidate.id))throw Error('candidate repeated');window.__consumedIds.push(candidate.id);window.__firstBatchWords.push(candidate.word);page=await api.recommendationFeedback(candidate.id,'known');if(page.remainingCount!==remaining-1||page.batchSize!==10)throw Error('consumption count');if(JSON.stringify(page.items.slice(0,Math.min(2,remaining-1)).map(x=>x.id))!==JSON.stringify(before.slice(1).map(x=>x.id)))throw Error('hidden queue order changed');}if(new Set(window.__consumedIds).size!==10||page.items.length!==0)throw Error('did not exhaust exactly ten candidates');window.__keptRecommendations=[];return true");
        click("翻译"); click("查词"); assertRecommendationGroup("exhausted queue stays empty on navigation",0);
        if (model.recommendationRequests.get()!=recommendationCalls || model.analysisRequests.get()!=analysisCalls) throw new Exception("Exhausting queue generated new recommendations");
        report.append("PASS all ten candidates consumed with no extra analysis or recommendation requests\n");
        evaluate(ui, "document.querySelector('[aria-label=\"更新推荐\"]').click()"); recommendationsSettled(10);
        check("explicit refresh restores ten new candidates", "const page=await api.getRecommendations({allowGenerate:false});if(page.items.some(x=>window.__firstBatchWords.includes(x.word)))throw Error('manual refresh repeated prior batch');if(page.targetLevel!=='B2'||page.remainingCount!==10||page.batchSize!==10)throw Error('manual refresh queue or preference');window.__keptRecommendations=page.items;return true");
        if (model.recommendationRequests.get()!=recommendationCalls+1 || model.analysisRequests.get()!=analysisCalls+1) throw new Exception("Manual refresh did not generate exactly one new group and analyze the saved word");
        evaluate(ui, "document.querySelector('[aria-label=\"已认识 '+window.__keptRecommendations[0].word+'\"]').click()");
        assertRecommendationConsumed("refreshed batch can also be consumed locally",9);
        String expectedState = async("const page=await api.getRecommendations({allowGenerate:false});return JSON.stringify({ids:page.items.map(x=>x.id),remainingCount:page.remainingCount,batchSize:page.batchSize})");
        if (model.recommendationRequests.get()!=recommendationCalls+1 || model.analysisRequests.get()!=analysisCalls+1) throw new Exception("Consuming refreshed queue generated new recommendations");
        try (FileOutputStream output = new FileOutputStream(new File(getTargetContext().getExternalFilesDir(null), "test-recommendation-ids.json"))) { output.write(expectedState.getBytes(StandardCharsets.UTF_8)); }
        report.append("PASS explicit refresh replaces batch and persists queue position\n");
        evaluate(ui, "document.querySelector('[aria-label=\"为你推荐\"]').scrollIntoView({block:'start'})"); screenshot("recommendations-light");
        evaluate(ui, "document.querySelector('button[title=\"切换深浅色\"]').click()"); Thread.sleep(200); screenshot("recommendations-dark");
        evaluate(ui, "document.querySelector('button[title=\"切换深浅色\"]').click()"); click("翻译");
        check("clipboard native write/read", "await navigator.clipboard.writeText('Android 中文剪贴板');if(await navigator.clipboard.readText()!=='Android 中文剪贴板')throw Error('clipboard');return true");
        evaluate(ui, "const e=document.querySelector('#source-text');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'We read books every day.');e.dispatchEvent(new Event('input',{bubbles:true}));"); Thread.sleep(300);
        click("选短语"); evaluate(ui, "document.querySelector('[data-word-index=\"1\"]').click()"); Thread.sleep(100); evaluate(ui, "document.querySelector('[data-word-index=\"2\"]').click()");
        check("touch phrase endpoints", "if(!document.querySelector('[data-selection-key=\"3:13\"]'))throw Error('phrase selection');return true");
        screenshot("phrase-light");
        click("生词本"); screenshot("vocabulary-light");
        click("设置"); screenshot("settings-light");
        evaluate(ui, "document.querySelector('button[title=\"切换深浅色\"]').click()"); Thread.sleep(200); screenshot("settings-dark");
        click("生词本"); screenshot("vocabulary-dark");
        click("翻译"); screenshot("translate-dark");
        // File picker cancellation completes the production export promise.
        evaluate(ui, "window.__exportResult=null;api.exportVocab('json').then(v=>window.__exportResult=v)"); Thread.sleep(1200);
        long pickerDeadline = System.currentTimeMillis() + 15000;
        while (System.currentTimeMillis() < pickerDeadline) {
          android.view.accessibility.AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
          if (root != null && String.valueOf(root.getPackageName()).contains("documentsui")) break;
          Thread.sleep(200);
        }
        Thread.sleep(1000);
        long time = android.os.SystemClock.uptimeMillis();
        getUiAutomation().injectInputEvent(new android.view.KeyEvent(time,time,android.view.KeyEvent.ACTION_DOWN,android.view.KeyEvent.KEYCODE_BACK,0),true);
        getUiAutomation().injectInputEvent(new android.view.KeyEvent(time,time,android.view.KeyEvent.ACTION_UP,android.view.KeyEvent.KEYCODE_BACK,0),true);
        check("system export cancellation", "for(let i=0;i<100&&!window.__exportResult;i++)await new Promise(r=>setTimeout(r,100));if(window.__exportResult?.status!=='cancelled')throw Error(JSON.stringify(window.__exportResult));return true");
        evaluate(ui, "window.__exportResult=null;api.exportVocab('csv').then(v=>window.__exportResult=v)");
        waitPicker(); Thread.sleep(500);
        android.view.accessibility.AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
        boolean saved = false;
        for (android.view.accessibility.AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText("SAVE")) {
          if (node.isClickable()) { saved = node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK); break; }
        }
        if (!saved) throw new Exception("Save button missing");
        String uri = async("for(let i=0;i<150&&!window.__exportResult;i++)await new Promise(r=>setTimeout(r,100));if(window.__exportResult?.status!=='saved')throw Error(JSON.stringify(window.__exportResult));return window.__exportResult.filePath");
        try (InputStream input = getTargetContext().getContentResolver().openInputStream(android.net.Uri.parse(uri))) {
          ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
          while ((count=input.read(buffer))!=-1) bytes.write(buffer,0,count);
          String csv = new String(bytes.toByteArray(),StandardCharsets.UTF_8);
          if (!csv.contains("Android persistent note") || !csv.contains("book")) throw new Exception("Export content missing");
        }
        report.append("PASS system CSV export and read-back\n");
        for (String name : new String[]{"settings.enc","database.enc"}) {
          File file = new File(getTargetContext().getFilesDir(),name);
          if (!file.exists() || file.length()<24) throw new Exception("Missing encrypted file");
          byte[] data = new byte[(int)file.length()]; try(FileInputStream input=new FileInputStream(file)){input.read(data);}
          String raw=new String(data,StandardCharsets.UTF_8);
          if(raw.contains("synthetic-test-only")||raw.contains("Android persistent note")) throw new Exception("Plaintext private data");
        }
        report.append("PASS Keystore encrypted private storage\n");
        if(model.requests<4)throw new Exception("Native TLS model was not called");
        model.close();
        report.append("PASS native HTTPS authorization, JSON body and real SSE\n");
      }
      results.putString("stream", report + "ANDROID_CHECKS_PASSED\n"); finish(Activity.RESULT_OK, results);
    } catch (Throwable error) {
      try { screenshot("failure"); } catch (Exception ignored) {}
      results.putString("stream", report + "FAIL " + error.toString()); finish(Activity.RESULT_CANCELED, results);
    }
  }
}
