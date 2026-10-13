package com.mytranslate.mobile.tests;

import android.content.Context;
import org.json.*;
import javax.net.ssl.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.Executors;

/** Test-only HTTPS model server. Test CA and credentials never enter the production APK. */
final class MockModel implements AutoCloseable {
  private final SSLServerSocket server;
  private final java.util.concurrent.ExecutorService threads = Executors.newCachedThreadPool();
  volatile int requests;
  final java.util.concurrent.atomic.AtomicInteger analysisRequests = new java.util.concurrent.atomic.AtomicInteger();
  final java.util.concurrent.atomic.AtomicInteger recommendationRequests = new java.util.concurrent.atomic.AtomicInteger();
  MockModel(Context context) throws Exception {
    KeyStore keys = KeyStore.getInstance("PKCS12");
    try (InputStream input = context.getAssets().open("model.p12")) { keys.load(input,"test-only-password".toCharArray()); }
    KeyManagerFactory keyManager=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    keyManager.init(keys,"test-only-password".toCharArray());
    TrustManagerFactory trust=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); trust.init(keys);
    SSLContext ssl=SSLContext.getInstance("TLS"); ssl.init(keyManager.getKeyManagers(),trust.getTrustManagers(),null);
    HttpsURLConnection.setDefaultSSLSocketFactory(ssl.getSocketFactory());
    server=(SSLServerSocket)ssl.getServerSocketFactory().createServerSocket(0,20,java.net.InetAddress.getByName("127.0.0.1"));
    threads.execute(()->{while(!server.isClosed())try{SSLSocket socket=(SSLSocket)server.accept();threads.execute(()->respond(socket));}catch(IOException ignored){}});
  }
  String url(){return "https://localhost:"+server.getLocalPort()+"/v1";}
  private String line(InputStream input) throws IOException {
    ByteArrayOutputStream bytes=new ByteArrayOutputStream(); int c;
    while((c=input.read())!=-1&&c!='\n')if(c!='\r')bytes.write(c);
    return bytes.toString("UTF-8");
  }
  private void respond(SSLSocket socket) {
    try(SSLSocket connection=socket){
      connection.setSoTimeout(10000);InputStream input=connection.getInputStream();String first=line(input),header;int length=0;boolean auth=false;
      while(!(header=line(input)).isEmpty()){
        if(header.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(header.substring(15).trim());
        if(header.toLowerCase(java.util.Locale.ROOT).startsWith("authorization:")&&header.contains("synthetic-test-only"))auth=true;
      }
      if(!auth||length<=0||length>1000000)throw new IOException("Invalid request");
      byte[] body=new byte[length];int read=0;while(read<length){int n=input.read(body,read,length-read);if(n<0)throw new EOFException();read+=n;}
      JSONObject request=new JSONObject(new String(body,StandardCharsets.UTF_8));requests++;
      boolean anthropic=first.contains("/messages");String content;
      if(request.optBoolean("stream")) {
        OutputStream output=connection.getOutputStream();output.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
        for(String text:new String[]{"你好，","世界。"}){
          JSONObject event=anthropic?new JSONObject().put("type","content_block_delta").put("delta",new JSONObject().put("type","text_delta").put("text",text)):new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("delta",new JSONObject().put("content",text))));
          output.write(("data: "+event+"\n\n").getBytes(StandardCharsets.UTF_8));output.flush();Thread.sleep(40);
        }
        output.write("data: [DONE]\n\n".getBytes(StandardCharsets.US_ASCII));output.flush();return;
      }
      JSONArray messages=request.getJSONArray("messages");String user="",system=request.optString("system","");
      for(int i=0;i<messages.length();i++){
        JSONObject message=messages.getJSONObject(i);
        if(message.getString("role").equals("user"))user=message.getString("content");
        if(message.getString("role").equals("system"))system=message.getString("content");
      }
      if(system.contains("vocabulary-analysis-v1")){
        analysisRequests.incrementAndGet();
        JSONArray vocabulary=new JSONObject(user).getJSONArray("vocabulary"),analyses=new JSONArray();
        for(int i=0;i<vocabulary.length();i++){
          JSONObject entry=vocabulary.getJSONObject(i);
          analyses.put(new JSONObject().put("entryId",entry.getInt("entryId")).put("lemma",entry.getString("word")).put("level","B1").put("topic","general").put("confidence",0.9).put("specialist",false));
        }
        content=new JSONObject().put("analyses",analyses).toString();
      }else if(system.contains("recommendations-v1")){
        recommendationRequests.incrementAndGet();
        JSONObject parameters=new JSONObject(user);JSONArray excluded=parameters.getJSONArray("excluded"),recommendations=new JSONArray();
        java.util.Set<String> omitted=new java.util.HashSet<>();
        for(int i=0;i<excluded.length();i++)omitted.add(excluded.getString(i));
        String[] names=("discover explore journey travel garden forest river valley bridge village story chapter express explain describe compare identify observe suggest consider support protect improve develop create design prepare arrange collect select achieve provide resolve maintain reflect recognize reveal connect balance gather deliver explore clarify preserve adapt sustain concise reliable insight nuance").split(" ");
        for(String word:names){
          if(omitted.contains(word))continue;
          recommendations.put(new JSONObject().put("word",word).put("lemma",word).put("forms",new JSONArray()).put("family",word).put("level",parameters.getString("targetLevel")).put("topic","general").put("pos","n.").put("meaning","推荐目标义项").put("reason","拓展日常阅读词汇，理解更多常见表达。").put("utility",4));
          omitted.add(word);if(recommendations.length()==10)break;
        }
        content=new JSONObject().put("recommendations",recommendations).toString();
      }else if(user.startsWith("{\"targets\":")){
        JSONArray targets=new JSONObject(user).getJSONArray("targets"),entries=new JSONArray();
        for(int i=0;i<targets.length();i++){JSONObject t=targets.getJSONObject(i);String original=t.getString("original");entries.put(new JSONObject().put("id",t.getInt("id")).put("original",original).put("word",original.equals("books")?"book":original).put("explanation","根据语境归一"));}
        content=new JSONObject().put("entries",entries).toString();
      }else content=new JSONObject().put("phonetic","/bʊk/").put("pos","n.").put("brief","书；书籍").put("usage","阅读用的书。").put("memory","每天阅读。").toString();
      JSONObject result=anthropic?new JSONObject().put("content",new JSONArray().put(new JSONObject().put("type","text").put("text",content))):new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("message",new JSONObject().put("content",content))));
      byte[] response=result.toString().getBytes(StandardCharsets.UTF_8);OutputStream output=connection.getOutputStream();
      output.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+response.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));output.write(response);output.flush();
    }catch(Exception error){android.util.Log.e("MockModelTest",error.toString());}
  }
  public void close() throws IOException {server.close();threads.shutdownNow();}
}
