package com.storyfabric.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.RSAPublicKeySpec;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.crypto.Cipher;
import net.openid.appauth.AuthorizationRequest;
import net.openid.appauth.AuthorizationService;
import net.openid.appauth.AuthorizationServiceConfiguration;
import net.openid.appauth.GrantTypeValues;
import net.openid.appauth.ResponseTypeValues;
import net.openid.appauth.TokenRequest;
import net.openid.appauth.TokenResponse;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Native-only Trailblazer OIDC and Sub2API account client. */
final class AndroidCloudAccountService {
    static final String ISSUER = "https://trauser.fengyao.xin:10048";
    static final String RESOURCE_BASE = "https://trasub2api.fengyao.xin:10048";
    static final String CLIENT_ID = "storyfabric-desktop";
    static final String RESOURCE = "urn:trailblazer:sub2api:storyfabric";
    static final String SCOPES = "openid profile email offline_access storyfabric:account:read storyfabric:connection:provision storyfabric:usage:read storyfabric:channels:read storyfabric:channel:write storyfabric:redeem storyfabric:credential:rotate storyfabric:models:invoke";
    static final String PREFIX = "/api/v1/integration/storyfabric";
    private static final long TRANSACTION_LIFETIME_MS = 600_000L;
    private static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
    private final Context context;
    private final AndroidCloudCredentialStore credentials;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final CountDownLatch ready = new CountDownLatch(1);
    private final AuthorizationService authorizationService;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile JSONObject state = new JSONObject();
    private volatile String accessToken;
    private volatile String refreshToken;
    private volatile String subject;
    private volatile String displayName;
    private volatile String email;
    private volatile long expiresAt;
    private volatile long generation = 0;
    private volatile JSONObject accountSummary;
    private volatile ServerSocket callbackSocket;
    private volatile AuthorizationRequest pendingRequest;
    private volatile Uri pendingRedirectUri;
    private volatile long pendingGeneration;
    private volatile long pendingStartedAt;
    private volatile JSONObject discovery;
    private volatile AuthorizationServiceConfiguration serviceConfiguration;
    private volatile JSONArray cachedJwks;
    private volatile long jwksCachedAt;
    private volatile AndroidCloudModelTransport modelTransport;

    AndroidCloudAccountService(Context context) {
        this.context = context.getApplicationContext();
        this.credentials = new AndroidCloudCredentialStore(this.context);
        this.authorizationService = new AuthorizationService(this.context);
        setState("signed-out", null, null);
        Thread restore = new Thread(this::restoreCredentials, "storyfabric-cloud-restore");
        restore.setDaemon(true);
        restore.start();
    }

    void setModelTransport(AndroidCloudModelTransport transport) { modelTransport = transport; }
    void close() { modelTransportCancelAll(); authorizationService.dispose(); executor.shutdownNow(); }

    JSONObject getState() throws Exception {
        awaitReady();
        synchronized (this) { return new JSONObject(state.toString()); }
    }

    JSONObject beginLogin(Activity activity) throws Exception {
        awaitReady();
        if (activity == null) throw new IllegalStateException("无法打开系统浏览器");
        final long requestGeneration;
        synchronized (this) {
            closeCallbackLocked();
            generation++;
            requestGeneration = generation;
            accessToken = null;
            refreshToken = null;
            subject = null;
            displayName = null;
            email = null;
            expiresAt = 0;
            accountSummary = null;
            credentials.clear();
            setStateLocked("authorizing", null, null);
        }
        modelTransportCancelAll();
        executor.execute(() -> startAuthorization(requestGeneration, activity));
        return getState();
    }

    JSONObject cancelLogin() throws Exception {
        awaitReady();
        synchronized (this) {
            generation++;
            closeCallbackLocked();
            accessToken = null; refreshToken = null; subject = null; displayName = null; email = null; expiresAt = 0; accountSummary = null;
            credentials.clear();
            setStateLocked("signed-out", null, null);
        }
        modelTransportCancelAll();
        return getState();
    }

    JSONObject logout() throws Exception {
        awaitReady();
        String revoke = refreshToken != null ? refreshToken : accessToken;
        synchronized (this) {
            generation++;
            closeCallbackLocked();
            accessToken = null; refreshToken = null; subject = null; displayName = null; email = null; expiresAt = 0; accountSummary = null;
            credentials.clear();
            setStateLocked("signed-out", null, null);
        }
        modelTransportCancelAll();
        if (revoke != null) try { revokeToken(revoke); } catch (Exception ignored) { }
        return getState();
    }

    JSONObject retryOnboarding() throws Exception {
        awaitReady();
        JSONObject result = accountRequest("/onboard", "POST", new JSONObject(), operationId());
        synchronized (this) {
            accountSummary = mapAccount(result);
            setStateLocked("signed-in", identityJson(), null);
            return new JSONObject(accountSummary.toString());
        }
    }

    JSONObject getAccount() throws Exception {
        awaitReady();
        JSONObject next = mapAccount(accountRequest("/account", "GET", null, null));
        JSONObject previous = accountSummary;
        if (previous != null && (integer(readObject(previous, "connection"), "configurationVersion") != integer(readObject(next, "connection"), "configurationVersion") || !string(readObject(previous, "connection"), "group.id").equals(string(readObject(next, "connection"), "group.id")))) {
            modelTransportCancelAll();
        }
        accountSummary = next;
        return new JSONObject(next.toString());
    }

    JSONObject getUsage(int page) throws Exception {
        awaitReady();
        int normalized = Math.max(1, Math.min(100_000, page));
        JSONObject raw = accountRequest("/usage?page=" + normalized + "&page_size=20", "GET", null, null);
        return mapUsage(raw);
    }

    JSONArray getGroups() throws Exception { awaitReady(); return mapGroups(accountRequest("/groups", "GET", null, null)); }
    JSONArray getChannels() throws Exception { return getGroups(); }
    JSONArray getSupplierLobby() throws Exception { awaitReady(); return mapLobby(accountRequest("/groups/lobby", "GET", null, null)); }

    JSONObject redeem(String code, String operationId) throws Exception {
        if (code == null || code.trim().isEmpty() || code.length() > 256) throw new IllegalArgumentException("兑换码无效");
        JSONObject body = new JSONObject(); body.put("code", code.trim());
        return mapRedeem(accountRequest("/redeem", "POST", body, operationId));
    }

    JSONArray getRedeemHistory() throws Exception { awaitReady(); return mapRedeems(accountRequest("/redeem/history", "GET", null, null)); }

    JSONObject selectGroup(String groupId, int expectedVersion, String operationId) throws Exception {
        validateWrite(operationId, expectedVersion, groupId);
        JSONObject body = new JSONObject(); body.put("groupId", groupId); body.put("expectedCredentialVersion", expectedVersion);
        JSONObject result = mapConnection(accountRequest("/connection/group", "PUT", body, operationId));
        accountSummary = replaceConnection(accountSummary, result);
        modelTransportCancelAll();
        return result;
    }

    JSONObject rotateConnection(int expectedVersion, String operationId) throws Exception {
        validateWrite(operationId, expectedVersion, null);
        JSONObject body = new JSONObject(); body.put("expectedCredentialVersion", expectedVersion);
        JSONObject result = mapConnection(accountRequest("/connection/rotate", "POST", body, operationId));
        accountSummary = replaceConnection(accountSummary, result);
        modelTransportCancelAll();
        return result;
    }

    String managedBaseUrl(String protocol) {
        String route = "gemini".equals(protocol) ? "/v1beta/models" : "/v1";
        return RESOURCE_BASE + PREFIX + "/gateway" + route;
    }

    JSONArray getModels(String protocol) throws Exception {
        if (modelTransport == null) throw new IllegalStateException("托管模型服务尚未初始化");
        return modelTransport.getModels(protocol);
    }

    String getPreferenceScope() throws Exception {
        awaitReady();
        JSONObject current = accountSummary;
        if (current == null || subject == null || !"signed-in".equals(state.optString("phase"))) return null;
        String groupId = "";
        JSONObject connection = current.optJSONObject("connection");
        if (connection != null && connection.optJSONObject("group") != null) groupId = connection.optJSONObject("group").optString("id", "");
        JSONArray scopeParts = new JSONArray().put(ISSUER).put(RESOURCE_BASE).put(subject);
        if (groupId.isEmpty()) scopeParts.put(JSONObject.NULL); else scopeParts.put(groupId);
        String source = scopeParts.toString();
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte value : digest) hex.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return hex.toString();
    }

    ModelBinding modelBinding() throws Exception {
        awaitReady();
        synchronized (this) {
            if (!"signed-in".equals(state.optString("phase")) || subject == null || accountSummary == null) throw new IllegalStateException("请先完成 Trailblazer 登录");
            JSONObject connection = accountSummary.optJSONObject("connection");
            if (connection == null) throw new IllegalStateException("云端托管连接尚未就绪");
            return new ModelBinding(generation, subject, integer(connection, "configurationVersion"));
        }
    }

    synchronized String modelAccessToken(ModelBinding binding) throws Exception {
        if (binding.generation != generation || !binding.subject.equals(subject)) throw new IllegalStateException("当前运行的账号已退出或更换，请重新开始");
        return accessTokenForCurrentSession(binding.generation, binding.subject);
    }

    synchronized boolean isBindingCurrent(ModelBinding binding) {
        if (binding == null || binding.generation != generation || !binding.subject.equals(subject)) return false;
        JSONObject connection = accountSummary == null ? null : accountSummary.optJSONObject("connection");
        return connection != null && integer(connection, "configurationVersion") == binding.configurationVersion;
    }

    private void modelTransportCancelAll() {
        AndroidCloudModelTransport transport = modelTransport;
        if (transport != null) transport.cancelAll();
    }

    private void startAuthorization(long requestGeneration, Activity activity) {
        ServerSocket listener = null;
        try {
            ensureDiscovery();
            listener = new ServerSocket();
            listener.setReuseAddress(false);
            listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 1);
            listener.setSoTimeout((int) TRANSACTION_LIFETIME_MS);
            Uri redirect = Uri.parse("http://127.0.0.1:" + listener.getLocalPort() + "/oauth/callback");
            Map<String, String> extra = new HashMap<>(); extra.put("resource", RESOURCE);
            AuthorizationRequest request = new AuthorizationRequest.Builder(serviceConfiguration, CLIENT_ID, ResponseTypeValues.CODE, redirect)
                    .setScope(SCOPES).setPrompt("consent").setAdditionalParameters(extra).build();
            synchronized (this) {
                if (requestGeneration != generation) { listener.close(); return; }
                callbackSocket = listener; pendingRequest = request; pendingRedirectUri = redirect; pendingGeneration = requestGeneration; pendingStartedAt = System.currentTimeMillis();
            }
            ServerSocket callbackListener = listener;
            Thread callback = new Thread(() -> awaitCallback(callbackListener, request, requestGeneration), "storyfabric-cloud-oauth-callback");
            callback.setDaemon(true); callback.start();
            Intent browser = new Intent(Intent.ACTION_VIEW, request.toUri());
            mainHandler.post(() -> {
                try {
                    synchronized (AndroidCloudAccountService.this) {
                        if (requestGeneration != generation) return;
                    }
                    activity.startActivity(browser);
                } catch (Exception error) {
                    failAuthorization(requestGeneration, "无法打开系统浏览器，请安装或启用浏览器后重试");
                }
            });
        } catch (Exception error) {
            if (listener != null) try { listener.close(); } catch (Exception ignored) { }
            failAuthorization(requestGeneration, safeMessage(error, "账户中心授权服务不可用，请检查网络连接"));
        }
    }

    private void awaitCallback(ServerSocket listener, AuthorizationRequest request, long requestGeneration) {
        try (ServerSocket server = listener; Socket socket = server.accept()) {
            socket.setSoTimeout(10_000);
            String requestLine;
            String hostHeader = null;
            try (InputStream input = new BufferedInputStream(socket.getInputStream())) {
                requestLine = readLine(input, 8192);
                String header;
                int headerBytes = 0;
                while ((header = readLine(input, 8192)) != null && !header.isEmpty()) {
                    headerBytes += header.length();
                    if (headerBytes > 16_384) throw new IllegalArgumentException("登录回调请求过大");
                    if (header.regionMatches(true, 0, "Host:", 0, 5)) hostHeader = header.substring(5).trim();
                }
            }
            String[] parts = requestLine == null ? new String[0] : requestLine.split(" ");
            if (parts.length != 3 || !"GET".equals(parts[0]) || !parts[1].startsWith("/oauth/callback?")) throw new IllegalArgumentException("登录回调地址无效");
            int expectedPort = listener.getLocalPort();
            if (hostHeader != null && !hostHeader.equals("127.0.0.1:" + expectedPort)) throw new IllegalArgumentException("登录回调主机无效");
            Uri callback = Uri.parse("http://127.0.0.1:" + expectedPort + parts[1]);
            String callbackState = callback.getQueryParameter("state");
            if (callbackState == null || !callbackState.equals(request.state)) throw new IllegalArgumentException("登录回调不匹配");
            String error = callback.getQueryParameter("error");
            String code = callback.getQueryParameter("code");
            if (error != null) throw new IllegalStateException("账户中心未完成授权");
            if (code == null || code.isEmpty()) throw new IllegalArgumentException("账户中心没有返回授权码");
            writeCallbackPage(socket);
            synchronized (this) {
                if (requestGeneration != generation || pendingGeneration != requestGeneration) return;
                callbackSocket = null;
                pendingRequest = null;
                pendingRedirectUri = null;
            }
            executor.execute(() -> completeAuthorization(requestGeneration, request, callback, code));
        } catch (Exception error) {
            failAuthorization(requestGeneration, safeMessage(error, "登录回调失败，请重新登录"));
        }
    }

    private static String readLine(InputStream input, int maxBytes) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int value;
        while ((value = input.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') bytes.write(value);
            if (bytes.size() > maxBytes) throw new IllegalArgumentException("登录回调请求过大");
        }
        if (value == -1 && bytes.size() == 0) return null;
        return new String(bytes.toByteArray(), StandardCharsets.US_ASCII);
    }

    private static void writeCallbackPage(Socket socket) throws Exception {
        String appReturn = "com.storyfabric.app://account-return";
        String body = "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>StoryFabric</title><p>授权已收到，正在返回 StoryFabric…</p><a href=\"" + appReturn + "\">如果没有自动返回，请点此处</a><script>setTimeout(function(){location.replace('" + appReturn + "')},80)</script>";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        OutputStream output = new BufferedOutputStream(socket.getOutputStream());
        output.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " + bytes.length + "\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        output.write(bytes); output.flush();
    }

    private void completeAuthorization(long requestGeneration, AuthorizationRequest request, Uri callback, String code) {
        try {
            synchronized (this) {
                if (requestGeneration != generation || pendingGeneration != requestGeneration || System.currentTimeMillis() - pendingStartedAt > TRANSACTION_LIFETIME_MS) throw new IllegalStateException("登录事务已过期");
            }
            Map<String, String> extra = new HashMap<>(); extra.put("resource", RESOURCE);
            TokenRequest tokenRequest = new TokenRequest.Builder(serviceConfiguration, CLIENT_ID)
                    .setGrantType(GrantTypeValues.AUTHORIZATION_CODE)
                    .setAuthorizationCode(code)
                    .setRedirectUri(request.redirectUri)
                    .setCodeVerifier(request.codeVerifier)
                    .setNonce(request.nonce)
                    .setScope(SCOPES)
                    .setAdditionalParameters(extra)
                    .build();
            TokenResponse tokens = performTokenRequest(tokenRequest);
            JSONObject claims = validateIdToken(tokens.idToken, request.nonce);
            String nextSubject = claims.optString("sub", "");
            if (nextSubject.isEmpty() || tokens.accessToken == null || tokens.accessToken.isEmpty()) throw new IllegalStateException("账户中心未返回有效身份");
            synchronized (this) {
                if (requestGeneration != generation) return;
                subject = nextSubject;
                displayName = claims.optString("name", null);
                email = claims.optString("email", null);
                accessToken = tokens.accessToken;
                refreshToken = tokens.refreshToken;
                expiresAt = tokens.accessTokenExpirationTime == null ? System.currentTimeMillis() + 300_000L : tokens.accessTokenExpirationTime;
                setStateLocked("provisioning", identityJson(), null);
                if (refreshToken != null && !refreshToken.isEmpty()) {
                    JSONObject credential = new JSONObject();
                    credential.put("refreshToken", refreshToken); credential.put("subject", subject);
                    if (displayName != null) credential.put("name", displayName);
                    if (email != null) credential.put("email", email);
                    try { credentials.write(credential); } catch (Exception ignored) { }
                }
            }
            JSONObject summary = mapAccount(accountRequest("/onboard", "POST", new JSONObject(), onboardingOperationId()));
            synchronized (this) {
                if (requestGeneration != generation) return;
                accountSummary = summary;
                setStateLocked("signed-in", identityJson(), null);
            }
        } catch (Exception error) {
            failAuthorization(requestGeneration, safeMessage(error, "授权未完成，请重新登录"));
        }
    }

    private void failAuthorization(long requestGeneration, String message) {
        synchronized (this) {
            if (requestGeneration != generation) return;
            closeCallbackLocked();
            pendingRequest = null; pendingRedirectUri = null;
            if (accessToken != null) setStateLocked("provisioning", identityJson(), message);
            else setStateLocked("signed-out", null, message);
        }
    }

    private void restoreCredentials() {
        try {
            JSONObject saved = credentials.read();
            if (saved == null) return;
            String storedRefresh = saved.optString("refreshToken", "");
            String storedSubject = saved.optString("subject", "");
            if (storedRefresh.isEmpty() || storedSubject.isEmpty()) throw new IllegalStateException("登录凭据无效");
            ensureDiscovery();
            TokenRequest request = new TokenRequest.Builder(serviceConfiguration, CLIENT_ID)
                    .setGrantType(GrantTypeValues.REFRESH_TOKEN)
                    .setRefreshToken(storedRefresh)
                    .setAdditionalParameters(singleton("resource", RESOURCE))
                    .build();
            TokenResponse refreshed = performTokenRequest(request);
            if (refreshed.accessToken == null || refreshed.accessToken.isEmpty()) throw new IllegalStateException("登录已失效，请重新登录");
            if (refreshed.idToken != null && !refreshed.idToken.isEmpty()) {
                JSONObject claims = validateIdToken(refreshed.idToken, null);
                if (!storedSubject.equals(claims.optString("sub", ""))) throw new IllegalStateException("刷新身份不匹配");
            }
            synchronized (this) {
                subject = storedSubject; displayName = saved.optString("name", null); email = saved.optString("email", null);
                accessToken = refreshed.accessToken; refreshToken = refreshed.refreshToken == null ? storedRefresh : refreshed.refreshToken;
                expiresAt = refreshed.accessTokenExpirationTime == null ? System.currentTimeMillis() + 300_000L : refreshed.accessTokenExpirationTime;
                setStateLocked("provisioning", identityJson(), null);
                JSONObject newCredential = new JSONObject(); newCredential.put("refreshToken", refreshToken); newCredential.put("subject", subject);
                if (displayName != null) newCredential.put("name", displayName);
                if (email != null) newCredential.put("email", email);
                credentials.write(newCredential);
            }
            JSONObject summary = mapAccount(accountRequest("/onboard", "POST", new JSONObject(), onboardingOperationId(), true));
            synchronized (this) { accountSummary = summary; setStateLocked("signed-in", identityJson(), null); }
        } catch (Exception error) {
            synchronized (this) {
                if (accessToken == null) {
                    credentials.clear();
                    refreshToken = null; subject = null; displayName = null; email = null; accountSummary = null;
                    setStateLocked("signed-out", null, safeMessage(error, "登录已失效，请重新登录"));
                } else {
                    accountSummary = null;
                    setStateLocked("provisioning", identityJson(), safeMessage(error, "账户连接未完成，请重试"));
                }
            }
        } finally { ready.countDown(); }
    }

    private void ensureDiscovery() throws Exception {
        if (serviceConfiguration != null) return;
        JSONObject metadata = null;
        Exception last = null;
        String[] paths = { "/.well-known/openid-configuration", "/api/.well-known/openid-configuration" };
        for (String path : paths) {
            try {
                metadata = getJson(ISSUER + path);
                break;
            } catch (Exception error) { last = error; }
        }
        if (metadata == null) throw last == null ? new IllegalStateException("账户中心 OIDC 配置不可用") : last;
        String actualIssuer = metadata.optString("issuer", "");
        if (!ISSUER.equals(actualIssuer)) throw new IllegalStateException("账户中心 issuer 不匹配");
        Uri authorization = trustedEndpoint(metadata.optString("authorization_endpoint", ""));
        Uri token = trustedEndpoint(metadata.optString("token_endpoint", ""));
        String jwks = metadata.optString("jwks_uri", "");
        trustedEndpoint(jwks);
        String revocation = metadata.optString("revocation_endpoint", "");
        if (!revocation.isEmpty()) trustedEndpoint(revocation);
        serviceConfiguration = new AuthorizationServiceConfiguration(authorization, token, null, null);
        discovery = metadata;
    }

    private Uri trustedEndpoint(String value) throws Exception {
        Uri uri = Uri.parse(value);
        Uri base = Uri.parse(ISSUER);
        if (!"https".equals(uri.getScheme()) || !base.getHost().equals(uri.getHost()) || base.getPort() != uri.getPort() || uri.getUserInfo() != null || uri.getFragment() != null) {
            throw new IllegalStateException("账户服务发现端点不受信任");
        }
        return uri;
    }

    private TokenResponse performTokenRequest(TokenRequest request) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        final TokenResponse[] result = new TokenResponse[1];
        final Exception[] failure = new Exception[1];
        authorizationService.performTokenRequest(request, (response, exception) -> {
            result[0] = response;
            failure[0] = exception;
            latch.countDown();
        });
        if (!latch.await(30, TimeUnit.SECONDS)) throw new IllegalStateException("账户中心响应超时");
        if (failure[0] != null) throw new IllegalStateException("账户中心令牌请求失败");
        if (result[0] == null) throw new IllegalStateException("账户中心没有返回令牌");
        return result[0];
    }

    private JSONObject validateIdToken(String token, String expectedNonce) throws Exception {
        if (token == null || token.isEmpty()) throw new IllegalStateException("账户中心未返回身份令牌");
        String[] segments = token.split("\\.");
        if (segments.length != 3) throw new IllegalStateException("身份令牌格式无效");
        JSONObject header = new JSONObject(new String(decodeUrl(segments[0]), StandardCharsets.UTF_8));
        JSONObject claims = new JSONObject(new String(decodeUrl(segments[1]), StandardCharsets.UTF_8));
        if (!"RS256".equals(header.optString("alg"))) throw new IllegalStateException("身份令牌签名算法无效");
        String keyId = header.optString("kid", "");
        JSONObject jwk = findJwk(keyId);
        BigInteger modulus = new BigInteger(1, decodeUrl(jwk.getString("n")));
        BigInteger exponent = new BigInteger(1, decodeUrl(jwk.getString("e")));
        RSAPublicKey publicKey = (RSAPublicKey) KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(modulus, exponent));
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(publicKey);
        verifier.update((segments[0] + "." + segments[1]).getBytes(StandardCharsets.US_ASCII));
        if (!verifier.verify(decodeUrl(segments[2]))) throw new IllegalStateException("身份令牌签名无效");
        if (!ISSUER.equals(claims.optString("iss", ""))) throw new IllegalStateException("身份令牌 issuer 不匹配");
        boolean audienceOk = CLIENT_ID.equals(claims.optString("aud", ""));
        JSONArray audiences = claims.optJSONArray("aud");
        if (audiences != null) for (int i = 0; i < audiences.length(); i++) if (CLIENT_ID.equals(audiences.optString(i))) audienceOk = true;
        if (!audienceOk) throw new IllegalStateException("身份令牌 audience 不匹配");
        if (claims.optLong("exp", 0) * 1000L <= System.currentTimeMillis() - 30_000L) throw new IllegalStateException("身份令牌已过期");
        if (expectedNonce != null && !expectedNonce.equals(claims.optString("nonce", ""))) throw new IllegalStateException("身份令牌 nonce 不匹配");
        return claims;
    }

    private JSONObject findJwk(String kid) throws Exception {
        JSONArray keys = cachedJwks;
        if (keys == null || System.currentTimeMillis() - jwksCachedAt > 86_400_000L) {
            JSONObject result = getJson(discovery.getString("jwks_uri"));
            keys = result.optJSONArray("keys");
            if (keys == null) throw new IllegalStateException("账户中心 JWKS 无效");
            cachedJwks = keys; jwksCachedAt = System.currentTimeMillis();
        }
        for (int i = 0; i < keys.length(); i++) {
            JSONObject key = keys.optJSONObject(i);
            if (key != null && kid.equals(key.optString("kid")) && "RSA".equals(key.optString("kty")) && "sig".equals(key.optString("use", "sig"))) return key;
        }
        cachedJwks = null;
        throw new IllegalStateException("账户中心签名密钥未找到");
    }

    private JSONObject accountRequest(String path, String method, JSONObject body, String idempotencyKey) throws Exception {
        return accountRequest(path, method, body, idempotencyKey, false);
    }

    private JSONObject accountRequest(String path, String method, JSONObject body, String idempotencyKey, boolean duringRestore) throws Exception {
        if (!duringRestore) awaitReady();
        long requestGeneration = generation;
        String token = accessTokenForCurrentSession(requestGeneration, subject);
        Uri base = Uri.parse(RESOURCE_BASE + PREFIX + path);
        if (!"https".equals(base.getScheme()) || !"trasub2api.fengyao.xin".equals(base.getHost()) || base.getPort() != 10048) throw new IllegalStateException("Sub2API 请求地址无效");
        java.net.HttpURLConnection connection = (java.net.HttpURLConnection) new URL(base.toString()).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15_000); connection.setReadTimeout(30_000);
        connection.setRequestMethod(method); connection.setRequestProperty("Authorization", "Bearer " + token); connection.setRequestProperty("Accept", "application/json");
        if (idempotencyKey != null) connection.setRequestProperty("Idempotency-Key", idempotencyKey);
        if (body != null) {
            connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        }
        int status = connection.getResponseCode();
        String responseBody = readResponse(connection, status);
        connection.disconnect();
        if (requestGeneration != generation) throw new IllegalStateException("账号已更换");
        if (status == 401) {
            invalidateSession("登录已失效，请重新登录");
            throw new IllegalStateException("登录已失效，请重新登录");
        }
        if (status < 200 || status >= 300) throw new IllegalStateException("账户服务请求失败（" + status + "）");
        JSONObject envelope = new JSONObject(responseBody);
        if (envelope.optInt("code", -1) != 0) throw new IllegalStateException("账户服务请求失败（" + status + "）");
        Object data = envelope.opt("data");
        if (data instanceof JSONObject) return (JSONObject) data;
        if (data instanceof JSONArray) return new JSONObject().put("items", data);
        throw new IllegalStateException("账户服务返回数据无效");
    }

    private synchronized String accessTokenForCurrentSession(long expectedGeneration, String expectedSubject) throws Exception {
        if (expectedGeneration != generation || accessToken == null || subject == null || !subject.equals(expectedSubject)) throw new IllegalStateException("当前运行的账号已退出或更换，请重新开始");
        if (expiresAt > System.currentTimeMillis() + 30_000L) return accessToken;
        if (refreshToken == null || refreshToken.isEmpty()) {
            invalidateSession("登录已到期，请重新登录");
            throw new IllegalStateException("登录已到期，请重新登录");
        }
        try {
            TokenRequest request = new TokenRequest.Builder(serviceConfiguration, CLIENT_ID)
                    .setGrantType(GrantTypeValues.REFRESH_TOKEN)
                    .setRefreshToken(refreshToken)
                    .setAdditionalParameters(singleton("resource", RESOURCE)).build();
            TokenResponse refreshed = performTokenRequest(request);
            if (refreshed.accessToken == null || refreshed.accessToken.isEmpty()) throw new IllegalStateException("登录已失效，请重新登录");
            if (refreshed.idToken != null) {
                JSONObject claims = validateIdToken(refreshed.idToken, null);
                if (!subject.equals(claims.optString("sub", ""))) throw new IllegalStateException("刷新身份不匹配");
            }
            accessToken = refreshed.accessToken;
            refreshToken = refreshed.refreshToken == null ? refreshToken : refreshed.refreshToken;
            expiresAt = refreshed.accessTokenExpirationTime == null ? System.currentTimeMillis() + 300_000L : refreshed.accessTokenExpirationTime;
            saveCredentials();
            return accessToken;
        } catch (Exception error) {
            invalidateSession("登录已失效，请重新登录");
            throw new IllegalStateException("登录已失效，请重新登录");
        }
    }

    private synchronized void invalidateSession(String error) {
        generation++; closeCallbackLocked();
        accessToken = null; refreshToken = null; subject = null; displayName = null; email = null; accountSummary = null; expiresAt = 0;
        credentials.clear(); setStateLocked("signed-out", null, error); modelTransportCancelAll();
    }

    private void saveCredentials() {
        if (refreshToken == null || subject == null) return;
        try {
            JSONObject value = new JSONObject(); value.put("refreshToken", refreshToken); value.put("subject", subject);
            if (displayName != null) value.put("name", displayName);
            if (email != null) value.put("email", email);
            credentials.write(value);
        } catch (Exception ignored) { }
    }

    private void revokeToken(String token) throws Exception {
        ensureDiscovery();
        String endpoint = discovery.optString("revocation_endpoint", "");
        if (endpoint.isEmpty()) return;
        trustedEndpoint(endpoint);
        String body = "token=" + enc(token) + "&client_id=" + enc(CLIENT_ID);
        java.net.HttpURLConnection connection = (java.net.HttpURLConnection) new URL(endpoint).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(5_000); connection.setReadTimeout(5_000);
        connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        try (OutputStream output = connection.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); }
        connection.getResponseCode(); connection.disconnect();
    }

    private void awaitReady() throws Exception {
        if (!ready.await(35, TimeUnit.SECONDS)) throw new IllegalStateException("账户服务初始化超时");
    }

    private synchronized void setStateLocked(String phase, JSONObject identity, String error) {
        setState(phase, identity, error);
    }

    private void setState(String phase, JSONObject identity, String error) {
        JSONObject next = new JSONObject();
        try {
            next.put("phase", phase);
            next.put("persistent", credentials.isAvailable());
            if (identity != null) next.put("identity", identity);
            if (error != null && !error.isEmpty()) next.put("error", sanitize(error));
        } catch (JSONException ignored) { }
        state = next;
    }

    private JSONObject identityJson() {
        JSONObject identity = new JSONObject();
        try {
            if (subject != null) identity.put("subject", subject);
            if (displayName != null && !displayName.isEmpty()) identity.put("name", displayName);
            if (email != null && !email.isEmpty()) identity.put("email", email);
        } catch (JSONException ignored) { }
        return identity;
    }

    private void closeCallbackLocked() {
        ServerSocket socket = callbackSocket; callbackSocket = null;
        if (socket != null) try { socket.close(); } catch (Exception ignored) { }
        pendingRequest = null; pendingRedirectUri = null;
    }

    private JSONObject mapAccount(JSONObject value) throws JSONException {
        JSONObject balance = object(value, "balance");
        JSONObject connection = mapConnection(object(value, "connection"));
        JSONObject result = new JSONObject();
        result.put("businessUserId", firstString(value, "businessUserId", "business_user_id"));
        result.put("status", firstString(value, "status"));
        result.put("balance", new JSONObject().put("amount", number(balance, "amount")).put("currency", firstString(balance, "currency")));
        result.put("connection", connection);
        return result;
    }

    private JSONObject mapConnection(JSONObject value) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("applicationId", firstString(value, "applicationId", "application_id"));
        result.put("status", firstString(value, "status"));
        result.put("credentialVersion", firstInt(value, "credentialVersion", "credential_version"));
        result.put("configurationVersion", firstInt(value, "configurationVersion", "configuration_version"));
        JSONObject group = value.optJSONObject("group");
        result.put("group", group == null ? JSONObject.NULL : new JSONObject().put("id", id(group.opt("id"))).put("name", group.optString("name", "")));
        return result;
    }

    private JSONObject replaceConnection(JSONObject summary, JSONObject connection) throws JSONException {
        if (summary == null) return summary;
        JSONObject next = new JSONObject(summary.toString()); next.put("connection", connection); return next;
    }

    private JSONArray mapGroups(JSONObject data) throws JSONException {
        JSONArray values = data.optJSONArray("items"); if (values == null) values = data.optJSONArray("groups"); if (values == null) values = new JSONArray();
        JSONArray result = new JSONArray();
        for (int i = 0; i < values.length(); i++) result.put(mapGroup(values.optJSONObject(i)));
        return result;
    }

    private JSONArray mapLobby(JSONObject data) throws JSONException {
        JSONArray values = data.optJSONArray("items"); if (values == null) values = data.optJSONArray("groups"); if (values == null) values = new JSONArray();
        JSONArray result = new JSONArray();
        for (int i = 0; i < values.length(); i++) {
            JSONObject input = values.optJSONObject(i); if (input == null) continue;
            JSONObject group = mapGroup(input); JSONArray models = input.optJSONArray("models"); JSONArray mapped = new JSONArray();
            if (models != null) for (int j = 0; j < models.length(); j++) {
                JSONObject model = models.optJSONObject(j); if (model == null) continue;
                JSONObject item = new JSONObject(); item.put("name", firstString(model, "model_name", "name")); item.put("billingMode", firstString(model, "billing_mode"));
                item.put("inputPrice", firstDouble(model, "effective_input_price", "input_price")); item.put("outputPrice", firstDouble(model, "effective_output_price", "output_price"));
                optionalNumber(item, "cacheReadPrice", model, "effective_cache_read_price", "cache_read_price");
                optionalNumber(item, "cacheWritePrice", model, "effective_cache_write_price", "cache_write_price"); mapped.put(item);
            }
            group.put("models", mapped); result.put(group);
        }
        return result;
    }

    private JSONObject mapGroup(JSONObject value) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("id", id(value == null ? null : value.opt("id")));
        result.put("name", firstString(value, "name"));
        optionalString(result, "platform", value, "platform"); optionalString(result, "description", value, "description");
        optionalNumber(result, "rate", value, "rateMultiplier", "rate_multiplier", "rate");
        return result;
    }

    private JSONObject mapUsage(JSONObject value) throws JSONException {
        JSONObject result = new JSONObject(); JSONArray items = value.optJSONArray("items"); JSONArray mapped = new JSONArray();
        if (items != null) for (int i = 0; i < items.length(); i++) {
            JSONObject input = items.optJSONObject(i); if (input == null) continue;
            JSONObject item = new JSONObject(); item.put("id", id(input.opt("id"))); item.put("model", firstString(input, "model"));
            Double total = firstNumber(input, "totalTokens");
            if (total == null) { double sum = 0; boolean has = false; String[] fields = { "inputTokens", "outputTokens", "cacheTokens" }; for (String field : fields) if (input.has(field) && !input.isNull(field)) { sum += input.optDouble(field, 0); has = true; } if (has) total = sum; }
            if (total != null) item.put("totalTokens", total);
            optionalNumber(item, "cost", input, "cost"); optionalString(item, "createdAt", input, "createdAt", "created_at"); mapped.put(item);
        }
        result.put("items", mapped); result.put("total", firstInt(value, "total")); result.put("page", firstInt(value, "page")); result.put("pageSize", firstInt(value, "page_size", "pageSize"));
        return result;
    }

    private JSONObject mapRedeem(JSONObject value) throws JSONException {
        JSONObject result = new JSONObject();
        if (value.has("id")) result.put("id", id(value.opt("id")));
        optionalString(result, "type", value, "type"); optionalNumber(result, "amount", value, "value", "amount"); optionalString(result, "createdAt", value, "usedAt", "createdAt");
        return result;
    }

    private JSONArray mapRedeems(JSONObject value) throws JSONException {
        JSONArray source = value.optJSONArray("items"); if (source == null) source = value.optJSONArray("records");
        JSONArray result = new JSONArray(); if (source == null) return result;
        for (int i = 0; i < source.length(); i++) { JSONObject item = source.optJSONObject(i); if (item != null) result.put(mapRedeem(item)); }
        return result;
    }

    private static JSONObject object(JSONObject parent, String name) { JSONObject value = parent == null ? null : parent.optJSONObject(name); return value == null ? new JSONObject() : value; }
    private static JSONObject readObject(JSONObject parent, String name) { return parent == null ? null : parent.optJSONObject(name); }
    private static String string(JSONObject value, String path) { if (value == null) return ""; if (path.indexOf('.') < 0) return value.optString(path, ""); String[] parts = path.split("\\."); JSONObject next = value; for (int i = 0; i < parts.length - 1; i++) next = next == null ? null : next.optJSONObject(parts[i]); return next == null ? "" : next.optString(parts[parts.length - 1], ""); }
    private static int integer(JSONObject value, String key) { return value == null ? 0 : value.optInt(key, 0); }
    private static int firstInt(JSONObject value, String... keys) { for (String key : keys) if (value != null && value.has(key) && !value.isNull(key)) return value.optInt(key, 0); return 0; }
    private static double number(JSONObject value, String key) { return value == null ? 0 : value.optDouble(key, 0); }
    private static double firstDouble(JSONObject value, String... keys) { Double n = firstNumber(value, keys); return n == null ? 0 : n; }
    private static Double firstNumber(JSONObject value, String... keys) { for (String key : keys) if (value != null && value.has(key) && !value.isNull(key)) { Object raw = value.opt(key); if (raw instanceof Number) return ((Number) raw).doubleValue(); if (raw instanceof String) try { return Double.parseDouble((String) raw); } catch (NumberFormatException ignored) { } } return null; }
    private static String firstString(JSONObject value, String... keys) { for (String key : keys) if (value != null && value.has(key) && !value.isNull(key)) return String.valueOf(value.opt(key)); return ""; }
    private static void optionalString(JSONObject target, String key, JSONObject source, String... fields) throws JSONException { for (String field : fields) if (source != null && source.has(field) && !source.isNull(field) && source.opt(field) instanceof String) { target.put(key, source.getString(field)); return; } }
    private static void optionalNumber(JSONObject target, String key, JSONObject source, String... fields) throws JSONException { Double value = firstNumber(source, fields); if (value != null && Double.isFinite(value)) target.put(key, value); }
    private static String id(Object value) { return value instanceof String || value instanceof Number ? String.valueOf(value) : ""; }
    private static Map<String, String> singleton(String key, String value) { Map<String, String> map = new HashMap<>(); map.put(key, value); return map; }

    private static void validateWrite(String operationId, int expectedVersion, String groupId) {
        if (operationId == null || !operationId.matches("[A-Za-z0-9_-]{16,128}")) throw new IllegalArgumentException("操作编号无效");
        if (expectedVersion < 1) throw new IllegalArgumentException("连接版本无效");
        if (groupId != null && (groupId.isEmpty() || groupId.length() > 128)) throw new IllegalArgumentException("分组无效");
    }

    private static String operationId() { return "storyfabric_" + UUID.randomUUID().toString().replace("-", ""); }
    private String onboardingOperationId() { return "storyfabric_" + onboardingNonce; }
    private final String onboardingNonce = UUID.randomUUID().toString().replace("-", "");
    private static String readResponse(java.net.HttpURLConnection connection, int status) throws Exception {
        InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        if (input == null) return "{}";
        try (InputStream stream = new BufferedInputStream(input); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = stream.read(buffer)) != -1) { if (output.size() + count > MAX_RESPONSE_BYTES) throw new IllegalStateException("账户服务响应过大"); output.write(buffer, 0, count); }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private JSONObject getJson(String url) throws Exception {
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) || !"trauser.fengyao.xin".equals(uri.getHost()) || uri.getPort() != 10048) throw new IllegalStateException("账户中心请求地址无效");
        java.net.HttpURLConnection connection = (java.net.HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10_000); connection.setReadTimeout(15_000); connection.setRequestProperty("Accept", "application/json");
        int status = connection.getResponseCode(); String body = readResponse(connection, status); connection.disconnect();
        if (status < 200 || status >= 300) throw new IllegalStateException("账户中心配置请求失败（" + status + "）");
        return new JSONObject(body);
    }

    private static byte[] decodeUrl(String value) { return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    private static String enc(String value) throws Exception { return URLEncoder.encode(value, "UTF-8"); }
    private static String safeMessage(Exception error, String fallback) {
        String message = error.getMessage(); if (message == null || message.trim().isEmpty()) return fallback;
        String clean = message.replaceAll("(?i)(code|state|id_token|access_token|refresh_token)=([^&\\s]+)", "$1=[hidden]").replaceAll("\\s+", " ");
        return clean.length() > 240 ? clean.substring(0, 240) : clean;
    }
    private static String sanitize(String message) { return message == null ? "" : message.replaceAll("(?i)(code|state|id_token|access_token|refresh_token)=([^&\\s]+)", "$1=[hidden]").replaceAll("\\s+", " "); }

    static final class ModelBinding {
        final long generation; final String subject; final int configurationVersion;
        ModelBinding(long generation, String subject, int configurationVersion) { this.generation = generation; this.subject = subject; this.configurationVersion = configurationVersion; }
    }
}
