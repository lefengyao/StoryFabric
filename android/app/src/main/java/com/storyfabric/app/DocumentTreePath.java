package com.storyfabric.app;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

final class DocumentTreePath {
    private DocumentTreePath() {}

    static List<String> segments(String path, boolean allowEmpty, boolean workspaceRoot) throws IOException {
        if (path == null) throw new IOException("路径不能为空");
        if (path.startsWith("/") || path.startsWith("\\") || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) throw new IOException("无效的工作区相对路径");
        List<String> parts = new ArrayList<>();
        if (!allowEmpty && path.isEmpty()) throw new IOException("路径不能为空");
        for (String part : path.split("/", -1)) {
            if (part.isEmpty()) {
                if (!path.isEmpty()) throw new IOException("无效的工作区相对路径");
                continue;
            }
            if (part.equals(".") || part.equals("..")) throw new IOException("禁止访问工作区外的路径");
            parts.add(part);
        }
        if (workspaceRoot && parts.size() > 1) throw new IOException("工作区根目录只能有一层");
        return parts;
    }
}
