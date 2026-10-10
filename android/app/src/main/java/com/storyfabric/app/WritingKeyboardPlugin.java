package com.storyfabric.app;

import android.view.View;
import android.view.ViewTreeObserver;
import android.graphics.Rect;
import android.os.Build;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Observe IME insets without replacing Capacitor's system bar inset listener. */
@CapacitorPlugin(name = "StoryFabricKeyboard")
public class WritingKeyboardPlugin extends Plugin {
    private View webView;
    private boolean lastVisible;
    private int lastHeight = -1;
    private final ViewTreeObserver.OnGlobalLayoutListener layoutListener = () -> publish();

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            webView = getBridge().getWebView();
            webView.getViewTreeObserver().addOnGlobalLayoutListener(layoutListener);
            publish();
        });
    }

    private JSObject state() {
        JSObject result = new JSObject();
        if (webView == null) { result.put("visible", false); result.put("viewportHeight", 0); return result; }
        View decor = getActivity().getWindow().getDecorView();
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
        boolean visible = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime());
        int imeHeight = insets == null ? 0 : insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
        int[] viewPosition = new int[2];
        webView.getLocationOnScreen(viewPosition);
        int height = webView.getHeight();
        if (visible && imeHeight > 0) {
            int keyboardTop;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Window bounds include the IME area even when adjustResize has
                // already reduced the DecorView, preventing a second subtraction.
                keyboardTop = getActivity().getWindowManager().getCurrentWindowMetrics().getBounds().bottom - imeHeight;
            } else {
                Rect visibleFrame = new Rect();
                decor.getWindowVisibleDisplayFrame(visibleFrame);
                keyboardTop = visibleFrame.bottom;
            }
            height = WritingKeyboardLayout.visibleHeight(height, viewPosition[1], keyboardTop);
        }
        result.put("visible", visible);
        result.put("viewportHeight", Math.round(height / getContext().getResources().getDisplayMetrics().density));
        return result;
    }

    private void publish() {
        JSObject current = state();
        boolean visible = current.optBoolean("visible");
        int height = current.optInt("viewportHeight");
        if (visible != lastVisible || height != lastHeight) {
            lastVisible = visible;
            lastHeight = height;
            notifyListeners("visibilityChange", current, true);
        }
    }

    @PluginMethod
    public void getState(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(state()));
    }

    @Override
    protected void handleOnDestroy() {
        if (webView != null && webView.getViewTreeObserver().isAlive()) {
            webView.getViewTreeObserver().removeOnGlobalLayoutListener(layoutListener);
        }
    }
}
