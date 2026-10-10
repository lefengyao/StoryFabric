package com.storyfabric.app;

import android.app.Activity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native OIDC, account-resource and managed-model boundary for Android. */
@CapacitorPlugin(name = "TrailblazerAccount")
public class TrailblazerAccountPlugin extends Plugin {
    private AndroidCloudAccountService accounts;
    private AndroidCloudModelTransport models;

    @Override public void load() {
        accounts = new AndroidCloudAccountService(getContext());
        models = new AndroidCloudModelTransport(accounts, new AndroidCloudModelTransport.Emitter() {
            @Override public void headers(String requestId, int status, JSONObject headers) {
                JSObject event = new JSObject(); event.put("requestId", requestId); event.put("status", status); event.put("headers", headers);
                notifyListeners("cloudModelHeaders", event);
            }
            @Override public void chunk(String requestId, String base64) {
                JSObject event = new JSObject(); event.put("requestId", requestId); event.put("chunk", base64);
                notifyListeners("cloudModelChunk", event);
            }
            @Override public void end(String requestId, String error) {
                JSObject event = new JSObject(); event.put("requestId", requestId);
                if (error != null) event.put("error", error);
                notifyListeners("cloudModelEnd", event);
            }
        });
        accounts.setModelTransport(models);
    }

    @PluginMethod public void getState(PluginCall call) { run(call, () -> accounts.getState()); }

    @PluginMethod public void beginLogin(PluginCall call) {
        run(call, () -> accounts.beginLogin(getActivity()));
    }

    @PluginMethod public void cancelLogin(PluginCall call) { run(call, () -> accounts.cancelLogin()); }
    @PluginMethod public void logout(PluginCall call) { run(call, () -> accounts.logout()); }
    @PluginMethod public void retryOnboarding(PluginCall call) { run(call, () -> accounts.retryOnboarding()); }
    @PluginMethod public void getAccount(PluginCall call) { run(call, () -> accounts.getAccount()); }
    @PluginMethod public void getUsage(PluginCall call) { run(call, () -> accounts.getUsage(number(call.getInt("page"), 1))); }
    @PluginMethod public void getGroups(PluginCall call) { runArray(call, () -> accounts.getGroups()); }
    @PluginMethod public void getChannels(PluginCall call) { runArray(call, () -> accounts.getChannels()); }
    @PluginMethod public void getSupplierLobby(PluginCall call) { runArray(call, () -> accounts.getSupplierLobby()); }
    @PluginMethod public void getRedeemHistory(PluginCall call) { runArray(call, () -> accounts.getRedeemHistory()); }

    @PluginMethod public void redeem(PluginCall call) {
        run(call, () -> accounts.redeem(call.getString("code"), call.getString("operationId")));
    }

    @PluginMethod public void selectGroup(PluginCall call) {
        run(call, () -> accounts.selectGroup(call.getString("groupId"), number(call.getInt("expectedCredentialVersion"), 0), call.getString("operationId")));
    }

    @PluginMethod public void rotateConnection(PluginCall call) {
        run(call, () -> accounts.rotateConnection(number(call.getInt("expectedCredentialVersion"), 0), call.getString("operationId")));
    }

    @PluginMethod public void getPreferenceScope(PluginCall call) {
        try { JSObject result = new JSObject(); result.put("scope", accounts.getPreferenceScope()); call.resolve(result); }
        catch (Exception error) { reject(call, error); }
    }

    @PluginMethod public void getModels(PluginCall call) {
        try { JSObject result = new JSObject(); result.put("models", new JSArray(models.getModels(call.getString("protocol")))); call.resolve(result); }
        catch (Exception error) { reject(call, error); }
    }

    @PluginMethod public void startModelRequest(PluginCall call) {
        String requestId = call.getString("requestId");
        try {
            models.start(requestId, call.getString("url"), call.getString("method", "GET"), call.getObject("headers"), call.getString("body"), new AndroidCloudModelTransport.Started() {
                @Override public void headers(int status, JSONObject headers) {
                    JSObject response = new JSObject(); response.put("status", status); response.put("headers", headers); call.resolve(response);
                }
                @Override public void error(Exception error) { reject(call, error); }
            });
        } catch (Exception error) { reject(call, error); }
    }

    @PluginMethod public void abortModelRequest(PluginCall call) {
        models.abort(call.getString("requestId")); call.resolve();
    }

    private interface JsonOperation { JSONObject run() throws Exception; }
    private interface ArrayOperation { JSONArray run() throws Exception; }

    private void run(PluginCall call, JsonOperation operation) {
        try { JSONObject result = operation.run(); call.resolve(JSObject.fromJSONObject(result)); }
        catch (Exception error) { reject(call, error); }
    }

    private void runArray(PluginCall call, ArrayOperation operation) {
        try { JSObject result = new JSObject(); result.put("items", new JSArray(operation.run())); call.resolve(result); }
        catch (Exception error) { reject(call, error); }
    }

    private static int number(Integer value, int fallback) { return value == null ? fallback : value; }

    private static void reject(PluginCall call, Exception error) {
        String message = error.getMessage();
        call.reject(message == null || message.trim().isEmpty() ? "Trailblazer 账户请求失败" : message, error);
    }

    @Override protected void handleOnDestroy() {
        if (accounts != null) accounts.close();
    }
}
