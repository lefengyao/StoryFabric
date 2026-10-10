package com.storyfabric.app;

import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** Fixed-origin Sub2API gateway. Session credentials and connection versions stay native. */
final class AndroidCloudModelTransport {
    static final String BASE = "https://trasub2api.fengyao.xin:10048/api/v1/integration/storyfabric/gateway/";
    private static final long MAX_REQUEST_BYTES = 8L * 1024L * 1024L;
    private static final long MAX_RESPONSE_BYTES = 256L * 1024L * 1024L;
    private final AndroidCloudAccountService accounts;
    private final Emitter emitter;
    private final ExecutorService workers = Executors.newCachedThreadPool(r -> {
        Thread thread = new Thread(r, "storyfabric-cloud-model"); thread.setDaemon(true); return thread;
    });
    private final Map<String, HttpURLConnection> active = new ConcurrentHashMap<>();
    private final Map<String, Boolean> cancelled = new ConcurrentHashMap<>();
    private final Map<String, Boolean> inFlight = new ConcurrentHashMap<>();

    interface Emitter {
        void headers(String requestId, int status, JSONObject headers);
        void chunk(String requestId, String base64);
        void end(String requestId, String error);
    }
    interface Started { void headers(int status, JSONObject headers); void error(Exception error); }

    AndroidCloudModelTransport(AndroidCloudAccountService accounts, Emitter emitter) {
        this.accounts = accounts; this.emitter = emitter;
    }

    void start(String requestId, String rawUrl, String method, JSONObject suppliedHeaders, String body, Started started) {
        if (requestId == null || !requestId.matches("[A-Za-z0-9_-]{16,128}")) throw new IllegalArgumentException("模型请求编号无效");
        if (cancelled.containsKey(requestId)) throw new IllegalStateException("模型请求已取消");
        validateUrl(rawUrl, method);
        if (body != null && body.getBytes(StandardCharsets.UTF_8).length > MAX_REQUEST_BYTES) throw new IllegalArgumentException("模型请求内容过大");
        inFlight.put(requestId, Boolean.TRUE);
        if (cancelled.containsKey(requestId)) { inFlight.remove(requestId); throw new IllegalStateException("模型请求已取消"); }
        final AndroidCloudAccountService.ModelBinding binding;
        try { binding = accounts.modelBinding(); } catch (Exception error) { inFlight.remove(requestId); throw new IllegalStateException(safeMessage(error)); }
        workers.execute(() -> perform(requestId, rawUrl, method, suppliedHeaders, body, binding, started));
    }

    void abort(String requestId) {
        if (requestId == null) return;
        cancelled.put(requestId, Boolean.TRUE);
        HttpURLConnection connection = active.remove(requestId);
        if (connection != null) connection.disconnect();
    }

    void cancelAll() {
        for (String id : inFlight.keySet()) abort(id);
    }

    JSONArray getModels(String protocol) throws Exception {
        String route;
        if ("gemini".equals(protocol)) route = "v1beta/models?pageSize=200";
        else if ("anthropic".equals(protocol)) route = "v1/models?limit=100";
        else if ("openai".equals(protocol)) route = "v1/models";
        else throw new IllegalArgumentException("模型协议无效");
        AndroidCloudAccountService.ModelBinding binding = accounts.modelBinding();
        HttpURLConnection connection = null;
        try {
            connection = open(BASE + route, "GET", null, binding);
            int status = connection.getResponseCode();
            String response = readAll(connection, status, 8 * 1024 * 1024);
            if (!accounts.isBindingCurrent(binding)) throw new IllegalStateException("云端连接已更换，请重新获取模型");
            if (status < 200 || status >= 300) throw new IllegalStateException("模型列表请求失败（" + status + "）");
            JSONObject json = new JSONObject(response);
            JSONArray values = json.optJSONArray("data");
            if (values == null) values = json.optJSONArray("models");
            if (values == null) values = json.optJSONArray("items");
            JSONArray names = new JSONArray();
            if (values != null) for (int i = 0; i < values.length(); i++) {
                Object raw = values.opt(i); String name = null;
                if (raw instanceof JSONObject) {
                    JSONObject item = (JSONObject) raw;
                    if ("gemini".equals(protocol)) {
                        JSONArray methods = item.optJSONArray("supportedGenerationMethods");
                        boolean supported = methods == null;
                        if (methods != null) for (int j = 0; j < methods.length(); j++) if ("generateContent".equals(methods.optString(j))) supported = true;
                        if (!supported) continue;
                        name = item.optString("name", "").replaceFirst("^models/", "");
                    } else name = item.optString("id", item.optString("name", ""));
                } else if (raw instanceof String) name = (String) raw;
                if (name != null && !name.trim().isEmpty()) names.put(name.trim());
            }
            return names;
        } finally { if (connection != null) connection.disconnect(); }
    }

    private void perform(String requestId, String rawUrl, String method, JSONObject suppliedHeaders, String body,
                         AndroidCloudAccountService.ModelBinding binding, Started started) {
        HttpURLConnection connection = null;
        boolean announced = false;
        try {
            if (cancelled.containsKey(requestId)) throw new IllegalStateException("模型请求已取消");
            connection = open(rawUrl, method, suppliedHeaders, binding);
            active.put(requestId, connection);
            if (cancelled.containsKey(requestId) || !accounts.isBindingCurrent(binding)) throw new IllegalStateException("模型请求已取消或云端连接已更换");
            if (body != null && !body.isEmpty()) {
                connection.setDoOutput(true);
                try (OutputStream output = new BufferedOutputStream(connection.getOutputStream())) {
                    output.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            JSONObject headers = publicHeaders(connection);
            started.headers(status, headers);
            announced = true;
            emitter.headers(requestId, status, headers);
            InputStream response = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (response != null) try (InputStream input = new BufferedInputStream(response)) {
                byte[] buffer = new byte[8192]; long bytes = 0; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (cancelled.containsKey(requestId)) throw new IllegalStateException("模型请求已取消");
                    if (!accounts.isBindingCurrent(binding)) throw new IllegalStateException("云端连接已更换，请重新开始本次运行");
                    bytes += count;
                    if (bytes > MAX_RESPONSE_BYTES) throw new IllegalStateException("模型响应过大");
                    byte[] chunk = new byte[count]; System.arraycopy(buffer, 0, chunk, 0, count);
                    emitter.chunk(requestId, Base64.encodeToString(chunk, Base64.NO_WRAP));
                }
            }
            emitter.end(requestId, null);
        } catch (Exception error) {
            String message = safeMessage(error);
            if (!announced) started.error(new IllegalStateException(message));
            else emitter.end(requestId, message);
        } finally {
            active.remove(requestId);
            inFlight.remove(requestId);
            cancelled.remove(requestId);
            if (connection != null) connection.disconnect();
        }
    }

    private HttpURLConnection open(String rawUrl, String method, JSONObject suppliedHeaders,
                                   AndroidCloudAccountService.ModelBinding binding) throws Exception {
        validateUrl(rawUrl, method);
        if (!accounts.isBindingCurrent(binding)) throw new IllegalStateException("云端连接已更换，请重新开始本次运行");
        HttpURLConnection connection = (HttpURLConnection) new URL(rawUrl).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(30_000); connection.setReadTimeout(180_000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization", "Bearer " + accounts.modelAccessToken(binding));
        connection.setRequestProperty("X-StoryFabric-Connection-Version", String.valueOf(binding.configurationVersion));
        connection.setRequestProperty("Accept", "application/json, text/event-stream, */*");
        if (suppliedHeaders != null) {
            Iterator<String> names = suppliedHeaders.keys();
            while (names.hasNext()) {
                String name = names.next(); String lower = name.toLowerCase(java.util.Locale.ROOT);
                if ("accept".equals(lower) || "content-type".equals(lower) || "anthropic-version".equals(lower) || "anthropic-beta".equals(lower)) {
                    String value = suppliedHeaders.optString(name, "");
                    if (value.length() <= 1024 && !value.contains("\r") && !value.contains("\n")) connection.setRequestProperty(name, value);
                }
            }
        }
        if (method.equals("POST")) connection.setDoOutput(true);
        return connection;
    }

    private static void validateUrl(String rawUrl, String method) {
        if (rawUrl == null || rawUrl.length() > 8192) throw new IllegalArgumentException("托管模型请求地址无效");
        Uri uri = Uri.parse(rawUrl);
        if (!"https".equals(uri.getScheme()) || !"trasub2api.fengyao.xin".equals(uri.getHost()) || uri.getPort() != 10048 || uri.getUserInfo() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("托管模型请求地址不受信任");
        }
        if (!uri.getPath().startsWith("/api/v1/integration/storyfabric/gateway/")) throw new IllegalArgumentException("托管模型请求地址无效");
        String route = uri.getPath().substring("/api/v1/integration/storyfabric/gateway/".length());
        boolean valid = route.matches("v1/(models|chat/completions|responses|messages)")
                || route.matches("v1beta/models")
                || route.matches("v1beta/models/[A-Za-z0-9._:-]+(?::(generateContent|streamGenerateContent))?");
        if (!valid) throw new IllegalArgumentException("托管模型请求路径无效");
        boolean get = "GET".equals(method), post = "POST".equals(method);
        if (!(get && (route.equals("v1/models") || route.equals("v1beta/models") || route.startsWith("v1beta/models/"))
                || post && (route.equals("v1/chat/completions") || route.equals("v1/responses") || route.equals("v1/messages") || route.startsWith("v1beta/models/")))) {
            throw new IllegalArgumentException("托管模型请求方法无效");
        }
        String key = uri.getQueryParameter("key");
        if (key != null && !key.isEmpty()) throw new IllegalArgumentException("托管模型请求不得携带 API Key");
    }

    private static JSONObject publicHeaders(HttpURLConnection connection) {
        JSONObject result = new JSONObject();
        try {
            for (String name : new String[] { "Content-Type", "Cache-Control", "Retry-After", "X-Request-Id", "X-StoryFabric-Connection-Version" }) {
                String value = connection.getHeaderField(name);
                if (value != null) result.put(name, value);
            }
        } catch (Exception ignored) { }
        return result;
    }

    private static String readAll(HttpURLConnection connection, int status, int maxBytes) throws Exception {
        InputStream response = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (response == null) return "{}";
        try (InputStream input = new BufferedInputStream(response); java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) { if (output.size() + count > maxBytes) throw new IllegalStateException("模型列表响应过大"); output.write(buffer, 0, count); }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static String safeMessage(Exception error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) return "托管模型请求失败";
        String clean = message.replaceAll("(?i)(authorization|bearer|api[_-]?key|access[_-]?token|refresh[_-]?token)=?[^&\\s,]+", "$1=[hidden]").replaceAll("\\s+", " ");
        return clean.substring(0, Math.min(240, clean.length()));
    }
}
