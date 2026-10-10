package com.storyfabric.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentTreePlugin.class);
        registerPlugin(WritingKeyboardPlugin.class);
        registerPlugin(TrailblazerAccountPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
