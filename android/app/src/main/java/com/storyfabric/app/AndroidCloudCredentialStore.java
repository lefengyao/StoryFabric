package com.storyfabric.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Stores only encrypted Trailblazer refresh credentials in app-private preferences. */
final class AndroidCloudCredentialStore {
    private static final String PREFS = "storyfabric.trailblazer.credentials";
    private static final String VALUE_KEY = "credential.v1";
    private static final String KEY_ALIAS = "storyfabric.trailblazer.refresh.v1";
    private static final byte[] AAD = "storyfabric.trailblazer.refresh.v1".getBytes(StandardCharsets.UTF_8);
    private final SharedPreferences preferences;

    AndroidCloudCredentialStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized JSONObject read() throws Exception {
        String stored = preferences.getString(VALUE_KEY, null);
        if (stored == null || stored.isEmpty()) return null;
        JSONObject envelope = new JSONObject(stored);
        byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(envelope.getString("data"), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        cipher.updateAAD(AAD);
        return new JSONObject(new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8));
    }

    synchronized void write(JSONObject credential) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(AAD);
        byte[] ciphertext = cipher.doFinal(credential.toString().getBytes(StandardCharsets.UTF_8));
        JSONObject envelope = new JSONObject();
        envelope.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        envelope.put("data", Base64.encodeToString(ciphertext, Base64.NO_WRAP));
        if (!preferences.edit().putString(VALUE_KEY, envelope.toString()).commit()) {
            throw new IllegalStateException("无法保存加密账户凭据");
        }
    }

    synchronized void clear() {
        preferences.edit().remove(VALUE_KEY).commit();
    }

    synchronized boolean isAvailable() {
        try {
            key();
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key existing = store.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }
}
