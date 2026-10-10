package com.storyfabric.app;

final class WritingKeyboardLayout {
    private WritingKeyboardLayout() {}

    static int visibleHeight(int viewHeight, int viewTop, int keyboardTop) {
        return Math.max(0, Math.min(viewHeight, keyboardTop - viewTop));
    }
}
