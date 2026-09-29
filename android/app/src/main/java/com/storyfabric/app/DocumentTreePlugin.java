package com.storyfabric.app;

import android.app.Activity;
import android.content.Intent;
import android.content.UriPermission;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** User-selected shared folders. No broad storage permission or raw filesystem path is accepted. */
@CapacitorPlugin(name = "StoryFabricDocuments")
public class DocumentTreePlugin extends Plugin {
    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "directoryPicked");
    }

    @ActivityCallback
    private void directoryPicked(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            response.put("uri", JSObject.NULL);
            call.resolve(response);
            return;
        }
        Uri uri = data.getData();
        int grant = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            if (grant != (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) {
                throw new IOException("需要所选文件夹的读写授权");
            }
            getContext().getContentResolver().takePersistableUriPermission(uri, grant);
            response.put("uri", uri.toString());
            call.resolve(response);
        } catch (Exception error) {
            call.reject(message(error), error);
        }
    }

    private String message(Exception error) {
        return error.getMessage() == null ? "外部文件夹操作失败" : error.getMessage();
    }

    private Uri authorizedTree(PluginCall call) throws IOException {
        String raw = call.getString("treeUri");
        if (raw == null || !raw.startsWith("content://")) throw new IOException("无效的外部文件夹授权");
        Uri uri = Uri.parse(raw);
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(uri) && permission.isReadPermission() && permission.isWritePermission()) return uri;
        }
        throw new IOException("外部目录授权已失效，请重新选择项目文件夹");
    }

    private List<String> segments(String path, boolean root) throws IOException {
        if (path == null) throw new IOException("路径不能为空");
        if (path.startsWith("/") || path.startsWith("\\") || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) throw new IOException("无效的工作区相对路径");
        List<String> parts = new ArrayList<>();
        if (!root && path.isEmpty()) throw new IOException("路径不能为空");
        for (String part : path.split("/", -1)) {
            if (part.isEmpty()) {
                if (!path.isEmpty()) throw new IOException("无效的工作区相对路径");
                continue;
            }
            if (part.equals(".") || part.equals("..")) throw new IOException("禁止访问工作区外的路径");
            parts.add(part);
        }
        if (root && parts.size() > 1) throw new IOException("工作区根目录只能有一层");
        return parts;
    }

    private DocumentFile resolve(PluginCall call, String path, boolean createDirectories) throws IOException {
        Uri uri = authorizedTree(call);
        DocumentFile current = DocumentFile.fromTreeUri(getContext(), uri);
        if (current == null || !current.isDirectory()) throw new IOException("外部目录不可访问");
        List<String> all = new ArrayList<>(segments(call.getString("root", ""), true));
        all.addAll(segments(path, true));
        for (int index = 0; index < all.size(); index++) {
            String part = all.get(index);
            DocumentFile next = current.findFile(part);
            if (next == null && createDirectories) next = current.createDirectory(part);
            if (next == null) return null;
            if (!next.isDirectory() && index < all.size() - 1) throw new IOException("路径被文件占用：" + part);
            current = next;
        }
        return current;
    }

    private DocumentFile parent(PluginCall call, String path) throws IOException {
        List<String> parts = segments(path, false);
        parts.remove(parts.size() - 1);
        DocumentFile parent = resolve(call, String.join("/", parts), true);
        if (parent == null || !parent.isDirectory()) throw new IOException("无法创建目标文件夹");
        return parent;
    }

    private String leaf(String path) throws IOException {
        List<String> parts = segments(path, false);
        return parts.get(parts.size() - 1);
    }

    @PluginMethod
    public void stat(PluginCall call) {
        try {
            DocumentFile file = resolve(call, call.getString("path", ""), false);
            JSObject result = new JSObject();
            result.put("exists", file != null && file.exists());
            if (file != null && file.exists()) {
                result.put("type", file.isDirectory() ? "directory" : "file");
                result.put("size", file.length());
                result.put("mtime", file.lastModified());
            }
            call.resolve(result);
        } catch (Exception error) { call.reject(message(error), error); }
    }

    @PluginMethod
    public void list(PluginCall call) {
        try {
            DocumentFile folder = resolve(call, call.getString("path", ""), false);
            if (folder != null && !folder.isDirectory()) throw new IOException("目标不是文件夹");
            JSArray entries = new JSArray();
            if (folder != null) for (DocumentFile file : folder.listFiles()) {
                JSObject entry = new JSObject();
                entry.put("name", file.getName());
                entry.put("type", file.isDirectory() ? "directory" : "file");
                entries.put(entry);
            }
            JSObject result = new JSObject();
            result.put("entries", entries);
            call.resolve(result);
        } catch (Exception error) { call.reject(message(error), error); }
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        try {
            String path = call.getString("path", "");
            DocumentFile folder;
            if (call.getBoolean("exclusive", false)) {
                DocumentFile parent = parent(call, path);
                String name = leaf(path);
                if (parent.findFile(name) != null) throw new IOException("目标文件夹已存在");
                folder = parent.createDirectory(name);
                if (folder != null && !name.equals(folder.getName())) {
                    folder.delete();
                    throw new IOException("文档提供方修改了文件夹名称");
                }
            } else folder = resolve(call, path, true);
            if (folder == null || !folder.isDirectory()) throw new IOException("无法创建文件夹");
            call.resolve();
        } catch (Exception error) { call.reject(message(error), error); }
    }

    private byte[] readAll(DocumentFile file) throws IOException {
        try (InputStream input = getContext().getContentResolver().openInputStream(file.getUri());
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IOException("无法读取文件");
            byte[] buffer = new byte[32768];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        try {
            DocumentFile file = resolve(call, call.getString("path", ""), false);
            JSObject result = new JSObject();
            result.put("exists", file != null);
            if (file != null) {
                if (!file.isFile()) throw new IOException("目标不是文件");
                result.put("data", Base64.encodeToString(readAll(file), Base64.NO_WRAP));
            }
            call.resolve(result);
        } catch (Exception error) { call.reject(message(error), error); }
    }

    private void writeAll(DocumentFile file, byte[] bytes) throws IOException {
        try (OutputStream output = getContext().getContentResolver().openOutputStream(file.getUri(), "rwt")) {
            if (output == null) throw new IOException("无法写入文件");
            output.write(bytes);
            output.flush();
        }
    }

    private DocumentFile createFileExact(DocumentFile folder, String name) throws IOException {
        DocumentFile file = folder.createFile("application/octet-stream", name);
        if (file == null) throw new IOException("无法创建目标文件");
        if (!name.equals(file.getName()) && (!file.renameTo(name) || !name.equals(file.getName()))) {
            file.delete();
            throw new IOException("文档提供方修改了文件名：" + name);
        }
        return file;
    }

    private void copyContent(DocumentFile source, DocumentFile target) throws IOException {
        try (InputStream input = getContext().getContentResolver().openInputStream(source.getUri());
             OutputStream output = getContext().getContentResolver().openOutputStream(target.getUri(), "rwt")) {
            if (input == null || output == null) throw new IOException("无法复制文件");
            byte[] buffer = new byte[32768];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        try {
            String path = call.getString("path");
            String data = call.getString("data");
            if (data == null) throw new IOException("写入内容不能为空");
            byte[] bytes = "base64".equals(call.getString("encoding"))
                ? Base64.decode(data, Base64.DEFAULT) : data.getBytes(StandardCharsets.UTF_8);
            DocumentFile folder = parent(call, path);
            String name = leaf(path);
            DocumentFile file = folder.findFile(name);
            if (file == null) file = createFileExact(folder, name);
            if (!file.isFile()) throw new IOException("目标不是文件");
            writeAll(file, bytes);
            call.resolve();
        } catch (Exception error) { call.reject(message(error), error); }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            DocumentFile file = resolve(call, call.getString("path"), false);
            if (file == null) {
                if (call.getBoolean("fileOnly", false)) throw new IOException("目标文件不存在");
                call.resolve();
                return;
            }
            if (call.getBoolean("fileOnly", false) && !file.isFile()) throw new IOException("目标不是文件");
            if (!file.delete()) throw new IOException("删除文件失败");
            call.resolve();
        } catch (Exception error) { call.reject(message(error), error); }
    }

    private DocumentFile copy(DocumentFile source, DocumentFile targetParent, String name) throws IOException {
        if (source.isDirectory()) {
            DocumentFile target = targetParent.createDirectory(name);
            if (target == null) throw new IOException("无法创建目标文件夹");
            for (DocumentFile child : source.listFiles()) {
                if (child.getName() == null) throw new IOException("源文件名无效");
                copy(child, target, child.getName());
            }
            return target;
        }
        DocumentFile target = createFileExact(targetParent, name);
        copyContent(source, target);
        return target;
    }

    @PluginMethod
    public void move(PluginCall call) {
        try {
            String from = call.getString("from");
            String to = call.getString("to");
            if (from == null || to == null) throw new IOException("移动路径不能为空");
            segments(from, false);
            segments(to, false);
            if (from.equals(to)) { call.resolve(); return; }
            if (to.startsWith(from + "/")) throw new IOException("不能把文件夹移动到自身内部");
            DocumentFile source = resolve(call, from, false);
            if (source == null) throw new IOException("源路径不存在");
            DocumentFile targetParent = parent(call, to);
            String targetName = leaf(to);
            DocumentFile previous = targetParent.findFile(targetName);
            if (previous != null && previous.isDirectory()) throw new IOException("目标文件夹已存在");
            String token = UUID.randomUUID().toString();
            String stageName = ".storyfabric-stage-" + token;
            DocumentFile stage = copy(source, targetParent, stageName);
            String backupName = ".storyfabric-backup-" + token;
            if (previous != null && !previous.renameTo(backupName)) {
                stage.delete();
                throw new IOException("无法备份原目标文件");
            }
            if (!stage.renameTo(targetName) || !targetName.equals(stage.getName())) {
                stage.delete();
                if (previous != null) previous.renameTo(targetName);
                throw new IOException("无法完成文件移动");
            }
            if (!source.delete()) throw new IOException("目标已写入，但源文件删除失败");
            if (previous != null) previous.delete();
            call.resolve();
        } catch (Exception error) { call.reject(message(error), error); }
    }
}
